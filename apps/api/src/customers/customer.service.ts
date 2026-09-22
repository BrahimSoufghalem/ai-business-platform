import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { VerifiedIdentity } from '@ai-business/auth';
import {
  CustomerContactValidationError,
  maskCustomerContact,
  normalizeCustomerContact,
  type CustomerContactType,
} from '@ai-business/domain';
import { withTenantTransaction, type TenantTransaction } from '@ai-business/db';
import { DatabaseService } from '../database/database.service.js';
import { authorizeTenantPermission } from '../tenancy/tenant-authorization.js';
import { createCandidateTenantContext } from '../tenancy/trusted-tenant-context.js';
import type {
  CreateCustomerInput,
  CreateCustomerNoteInput,
  CustomerAddressInput,
  CustomerContactInput,
  CustomerSearchInput,
  UpdateCustomerInput,
} from './customer.schemas.js';

export interface CustomerContactView {
  readonly id: string;
  readonly type: CustomerContactType;
  readonly maskedValue: string;
  readonly label: string | null;
  readonly isPrimary: boolean;
}

export interface CustomerAddressView {
  readonly id: string;
  readonly label: string | null;
  readonly recipientName: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string;
  readonly isDefault: boolean;
}

export interface CustomerSummaryView {
  readonly id: string;
  readonly name: string;
  readonly status: 'active' | 'archived';
  readonly version: number;
  readonly contacts: readonly CustomerContactView[];
  readonly conversationCount: number;
  readonly orderCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomerView extends CustomerSummaryView {
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly addresses: readonly CustomerAddressView[];
  readonly notes: readonly {
    id: string;
    body: string;
    authorId: string;
    createdAt: string;
  }[];
  readonly conversations: readonly {
    id: string;
    channel: string;
    status: string;
    subject: string | null;
    lastMessageAt: string | null;
    createdAt: string;
  }[];
  readonly orders: readonly {
    id: string;
    number: string;
    status: string;
    total: string;
    currency: string;
    createdAt: string;
  }[];
}

export interface CreateCustomerResult {
  readonly customer: CustomerView;
  readonly deduplicated: boolean;
}

interface PreparedContact {
  readonly type: CustomerContactType;
  readonly value: string;
  readonly normalizedValue: string;
  readonly label: string | null;
  readonly isPrimary: boolean;
}

type JsonInput = Parameters<TenantTransaction['json']>[0];

function jsonInput(value: unknown): JsonInput {
  return value as JsonInput;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class CustomerService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private prepareContacts(contacts: readonly CustomerContactInput[]): PreparedContact[] {
    try {
      const explicitPrimaryTypes = new Set(
        contacts.filter((contact) => contact.isPrimary).map((contact) => contact.type),
      );
      const firstType = new Set<CustomerContactType>();
      const keys = new Set<string>();
      return contacts.map((contact) => {
        const normalizedValue = normalizeCustomerContact(contact.type, contact.value);
        if (keys.has(normalizedValue)) {
          throw new BadRequestException('The same contact appears more than once.');
        }
        keys.add(normalizedValue);
        const isFirst = !firstType.has(contact.type);
        firstType.add(contact.type);
        return {
          type: contact.type,
          value: contact.value.trim(),
          normalizedValue,
          label: contact.label ?? null,
          isPrimary: contact.isPrimary || (!explicitPrimaryTypes.has(contact.type) && isFirst),
        };
      });
    } catch (error) {
      if (error instanceof CustomerContactValidationError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private validateAddresses(addresses: readonly CustomerAddressInput[]): void {
    if (addresses.filter((address) => address.isDefault).length > 1) {
      throw new BadRequestException('Only one default customer address is allowed.');
    }
  }

  private async insertContacts(
    transaction: TenantTransaction,
    tenantId: string,
    customerId: string,
    contacts: readonly PreparedContact[],
  ): Promise<void> {
    for (const contact of contacts) {
      await transaction`
        insert into customer_contacts (
          tenant_id, customer_id, type, value, normalized_value, label, is_primary
        ) values (
          ${tenantId}, ${customerId}, ${contact.type}, ${contact.value},
          ${contact.normalizedValue}, ${contact.label}, ${contact.isPrimary}
        )
      `;
    }
  }

  private async insertAddresses(
    transaction: TenantTransaction,
    tenantId: string,
    customerId: string,
    addresses: readonly CustomerAddressInput[],
  ): Promise<void> {
    this.validateAddresses(addresses);
    const hasExplicitDefault = addresses.some((address) => address.isDefault);
    for (const [index, address] of addresses.entries()) {
      await transaction`
        insert into customer_addresses (
          tenant_id, customer_id, label, recipient_name, line1, line2, city,
          region, postal_code, country_code, is_default
        ) values (
          ${tenantId}, ${customerId}, ${address.label ?? null},
          ${address.recipientName ?? null}, ${address.line1}, ${address.line2 ?? null},
          ${address.city}, ${address.region ?? null}, ${address.postalCode ?? null},
          ${address.countryCode}, ${address.isDefault || (!hasExplicitDefault && index === 0)}
        )
      `;
    }
  }

  private async loadContacts(
    transaction: TenantTransaction,
    tenantId: string,
    customerId: string,
  ): Promise<CustomerContactView[]> {
    const rows = await transaction<
      {
        id: string;
        type: CustomerContactType;
        normalizedValue: string;
        label: string | null;
        isPrimary: boolean;
      }[]
    >`
      select
        id::text, type::text, normalized_value as "normalizedValue",
        label, is_primary as "isPrimary"
      from customer_contacts
      where tenant_id = ${tenantId} and customer_id = ${customerId}
      order by is_primary desc, type, created_at, id
    `;
    return rows.map(({ normalizedValue, ...contact }) => ({
      ...contact,
      maskedValue: maskCustomerContact(contact.type, normalizedValue),
    }));
  }

  private async loadSummary(
    transaction: TenantTransaction,
    tenantId: string,
    customerId: string,
  ): Promise<CustomerSummaryView | null> {
    const [row] = await transaction<
      {
        id: string;
        name: string;
        status: 'active' | 'archived';
        version: number;
        conversationCount: number;
        orderCount: number;
        createdAt: Date;
        updatedAt: Date;
      }[]
    >`
      select
        customer.id::text, customer.name, customer.status::text, customer.version,
        (
          select count(*)::int from conversations
          where tenant_id = ${tenantId} and customer_id = customer.id
        ) as "conversationCount",
        (
          select count(*)::int from orders
          where tenant_id = ${tenantId} and customer_id = customer.id
        ) as "orderCount",
        customer.created_at as "createdAt", customer.updated_at as "updatedAt"
      from customers as customer
      where customer.tenant_id = ${tenantId} and customer.id = ${customerId}
      limit 1
    `;
    if (!row) return null;
    return {
      ...row,
      contacts: await this.loadContacts(transaction, tenantId, customerId),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async loadCustomer(
    transaction: TenantTransaction,
    tenantId: string,
    customerId: string,
  ): Promise<CustomerView | null> {
    const summary = await this.loadSummary(transaction, tenantId, customerId);
    if (!summary) return null;
    const [core] = await transaction<{ metadata: Record<string, unknown> }[]>`
      select metadata
      from customers
      where tenant_id = ${tenantId} and id = ${customerId}
      limit 1
    `;
    if (!core) return null;
    const addresses = await transaction<CustomerAddressView[]>`
      select
        id::text, label, recipient_name as "recipientName", line1, line2, city,
        region, postal_code as "postalCode", country_code as "countryCode",
        is_default as "isDefault"
      from customer_addresses
      where tenant_id = ${tenantId} and customer_id = ${customerId}
      order by is_default desc, created_at, id
    `;
    const noteRows = await transaction<
      { id: string; body: string; authorId: string; createdAt: Date }[]
    >`
      select id::text, body, author_id as "authorId", created_at as "createdAt"
      from customer_notes
      where tenant_id = ${tenantId} and customer_id = ${customerId}
      order by created_at desc, id desc
      limit 100
    `;
    const conversationRows = await transaction<
      {
        id: string;
        channel: string;
        status: string;
        subject: string | null;
        lastMessageAt: Date | null;
        createdAt: Date;
      }[]
    >`
      select
        id::text, channel::text, status::text, subject,
        last_message_at as "lastMessageAt", created_at as "createdAt"
      from conversations
      where tenant_id = ${tenantId} and customer_id = ${customerId}
      order by coalesce(last_message_at, created_at) desc, id
      limit 100
    `;
    const orderRows = await transaction<
      {
        id: string;
        number: string;
        status: string;
        total: string;
        currency: string;
        createdAt: Date;
      }[]
    >`
      select id::text, number, status::text, total::text, currency, created_at as "createdAt"
      from orders
      where tenant_id = ${tenantId} and customer_id = ${customerId}
      order by created_at desc, id
      limit 100
    `;
    return {
      ...summary,
      metadata: core.metadata,
      addresses,
      notes: noteRows.map((note) => ({ ...note, createdAt: note.createdAt.toISOString() })),
      conversations: conversationRows.map((conversation) => ({
        ...conversation,
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        createdAt: conversation.createdAt.toISOString(),
      })),
      orders: orderRows.map((order) => ({ ...order, createdAt: order.createdAt.toISOString() })),
    };
  }

  async create(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: CreateCustomerInput,
  ): Promise<CreateCustomerResult> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    const contacts = this.prepareContacts(input.contacts);
    this.validateAddresses(input.addresses);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'conversations:manage');
        await transaction`
          select pg_advisory_xact_lock(
            hashtextextended(${`${context.tenantId}:customers`}, 0::bigint)
          )
        `;
        const matchedCustomerIds = new Set<string>();
        for (const contact of contacts) {
          const [match] = await transaction<{ customerId: string }[]>`
            select customer_id::text as "customerId"
            from customer_contacts
            where tenant_id = ${context.tenantId}
              and normalized_value = ${contact.normalizedValue}
            limit 1
          `;
          if (match) matchedCustomerIds.add(match.customerId);
        }
        if (matchedCustomerIds.size > 1) {
          throw new ConflictException(
            'The supplied contacts belong to different existing customers.',
          );
        }
        const [existingCustomerId] = matchedCustomerIds;
        if (existingCustomerId) {
          await transaction`
            insert into audit_events (
              tenant_id, actor_type, actor_id, action, entity_type,
              entity_id, correlation_id, metadata
            ) values (
              ${context.tenantId}, 'user', ${identity.subject}, 'customer.deduplicated',
              'customer', ${existingCustomerId}, ${correlationId},
              ${transaction.json({ matchedContactCount: matchedCustomerIds.size })}
            )
          `;
          const existing = await this.loadCustomer(
            transaction,
            context.tenantId,
            existingCustomerId,
          );
          if (!existing) throw new Error('Deduplicated customer could not be loaded.');
          return { customer: existing, deduplicated: true };
        }

        const [created] = await transaction<{ id: string }[]>`
          insert into customers (tenant_id, name, metadata)
          values (
            ${context.tenantId}, ${input.name},
            ${transaction.json(jsonInput(input.metadata))}
          )
          returning id::text
        `;
        if (!created) throw new Error('Customer insert returned no ID.');
        await this.insertContacts(transaction, context.tenantId, created.id, contacts);
        await this.insertAddresses(transaction, context.tenantId, created.id, input.addresses);
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type,
            entity_id, correlation_id, metadata
          ) values (
            ${context.tenantId}, 'user', ${identity.subject}, 'customer.created',
            'customer', ${created.id}, ${correlationId},
            ${transaction.json({
              contactTypes: [...new Set(contacts.map((contact) => contact.type))],
              addressCount: input.addresses.length,
            })}
          )
        `;
        const customer = await this.loadCustomer(transaction, context.tenantId, created.id);
        if (!customer) throw new Error('Created customer could not be loaded.');
        return { customer, deduplicated: false };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A contact is already linked to another customer.');
      }
      throw error;
    }
  }

  async list(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    input: CustomerSearchInput,
  ): Promise<CustomerSummaryView[]> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:read');
      const textPattern = `%${input.q}%`;
      let contactQuery = input.q.toLowerCase().replace(/[\s().-]/g, '');
      if (input.q.length > 0) {
        try {
          const inferredType: CustomerContactType = input.q.includes('@') ? 'email' : 'phone';
          contactQuery = normalizeCustomerContact(inferredType, input.q);
        } catch {
          // Keep the normalized fragment for partial-name, handle, or phone searches.
        }
      }
      const contactPattern = `%${contactQuery}%`;
      const ids = await transaction<{ id: string }[]>`
        select customer.id::text
        from customers as customer
        where customer.tenant_id = ${context.tenantId}
          and (
            ${input.status ?? null}::customer_status is null
            or customer.status = ${input.status ?? null}::customer_status
          )
          and (
            ${input.q} = ''
            or customer.name ilike ${textPattern}
            or exists (
              select 1 from customer_contacts as contact
              where contact.tenant_id = customer.tenant_id
                and contact.customer_id = customer.id
                and contact.normalized_value ilike ${contactPattern}
            )
          )
        order by customer.updated_at desc, customer.id
        limit ${input.limit}
      `;
      const customers: CustomerSummaryView[] = [];
      for (const { id } of ids) {
        const customer = await this.loadSummary(transaction, context.tenantId, id);
        if (customer) customers.push(customer);
      }
      return customers;
    });
  }

  async get(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    customerId: string,
  ): Promise<CustomerView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:read');
      const customer = await this.loadCustomer(transaction, context.tenantId, customerId);
      if (!customer) throw new NotFoundException('Customer not found.');
      return customer;
    });
  }

  async update(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    customerId: string,
    input: UpdateCustomerInput,
  ): Promise<CustomerView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    const contacts = input.contacts ? this.prepareContacts(input.contacts) : undefined;
    if (input.addresses) this.validateAddresses(input.addresses);
    try {
      return await withTenantTransaction(this.database.client, context, async (transaction) => {
        await authorizeTenantPermission(transaction, context.tenantId, 'conversations:manage');
        const [current] = await transaction<
          {
            name: string;
            status: 'active' | 'archived';
            metadata: Record<string, unknown>;
            version: number;
          }[]
        >`
          select name, status::text, metadata, version
          from customers
          where tenant_id = ${context.tenantId} and id = ${customerId}
          limit 1
          for update
        `;
        if (!current) throw new NotFoundException('Customer not found.');
        if (current.version !== input.expectedVersion) {
          throw new ConflictException({
            message: 'Customer changed; reload before editing.',
            currentVersion: current.version,
          });
        }
        await transaction`
          update customers
          set
            name = ${input.name ?? current.name},
            status = ${input.status ?? current.status},
            metadata = ${transaction.json(jsonInput(input.metadata ?? current.metadata))},
            version = version + 1,
            updated_at = now()
          where tenant_id = ${context.tenantId} and id = ${customerId}
        `;
        if (contacts) {
          await transaction`
            delete from customer_contacts
            where tenant_id = ${context.tenantId} and customer_id = ${customerId}
          `;
          await this.insertContacts(transaction, context.tenantId, customerId, contacts);
        }
        if (input.addresses) {
          await transaction`
            delete from customer_addresses
            where tenant_id = ${context.tenantId} and customer_id = ${customerId}
          `;
          await this.insertAddresses(transaction, context.tenantId, customerId, input.addresses);
        }
        await transaction`
          insert into audit_events (
            tenant_id, actor_type, actor_id, action, entity_type,
            entity_id, correlation_id, metadata
          ) values (
            ${context.tenantId}, 'user', ${identity.subject}, 'customer.updated',
            'customer', ${customerId}, ${correlationId},
            ${transaction.json({
              previousVersion: current.version,
              contactsReplaced: contacts !== undefined,
              addressesReplaced: input.addresses !== undefined,
            })}
          )
        `;
        const customer = await this.loadCustomer(transaction, context.tenantId, customerId);
        if (!customer) throw new Error('Updated customer could not be loaded.');
        return customer;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('A contact is already linked to another customer.');
      }
      throw error;
    }
  }

  async addNote(
    identity: VerifiedIdentity,
    correlationId: string,
    candidateTenantId: string,
    customerId: string,
    input: CreateCustomerNoteInput,
  ): Promise<CustomerView> {
    const context = createCandidateTenantContext(identity, candidateTenantId, correlationId);
    return withTenantTransaction(this.database.client, context, async (transaction) => {
      await authorizeTenantPermission(transaction, context.tenantId, 'conversations:manage');
      const [customer] = await transaction<{ id: string }[]>`
        select id::text from customers
        where tenant_id = ${context.tenantId} and id = ${customerId}
        limit 1
      `;
      if (!customer) throw new NotFoundException('Customer not found.');
      const [note] = await transaction<{ id: string }[]>`
        insert into customer_notes (tenant_id, customer_id, body, author_id)
        values (${context.tenantId}, ${customerId}, ${input.body}, ${identity.subject})
        returning id::text
      `;
      if (!note) throw new Error('Customer note insert returned no ID.');
      await transaction`
        insert into audit_events (
          tenant_id, actor_type, actor_id, action, entity_type,
          entity_id, correlation_id, metadata
        ) values (
          ${context.tenantId}, 'user', ${identity.subject}, 'customer.note.created',
          'customer_note', ${note.id}, ${correlationId},
          ${transaction.json({ customerId })}
        )
      `;
      const result = await this.loadCustomer(transaction, context.tenantId, customerId);
      if (!result) throw new Error('Customer with note could not be loaded.');
      return result;
    });
  }
}
