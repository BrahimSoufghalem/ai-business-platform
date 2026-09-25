'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useApi, useStore, useTenantPath } from '../../../../components/providers';
import { useAsyncData } from '../../../../lib/use-async-data';
import { formatDateTime } from '../../../../lib/format';
import type {
  AgentLanguage,
  AgentSettingsHistoryView,
  AgentTone,
  BusinessRuleSetView,
  KnowledgeEntryView,
  KnowledgeKind,
  PricingPolicy,
} from '../../../../lib/api/types';
import { Tabs } from '../../../../components/ui/tabs';
import { PageHeader } from '../../../../components/ui/page-header';
import { Button } from '../../../../components/ui/button';
import { FormField } from '../../../../components/ui/form-field';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { Textarea } from '../../../../components/ui/textarea';
import { Checkbox } from '../../../../components/ui/checkbox';
import { Badge } from '../../../../components/ui/badge';
import { InlineAlert } from '../../../../components/ui/alert';
import { EmptyState } from '../../../../components/ui/empty-state';
import { ErrorState } from '../../../../components/ui/error-state';
import { Skeleton } from '../../../../components/ui/skeleton';
import { Dialog } from '../../../../components/ui/dialog';
import { ConfirmDialog } from '../../../../components/ui/confirm-dialog';
import { Icon } from '../../../../components/icons';
import { useToast } from '../../../../components/ui/toast';

const DEFAULT_POLICY: PricingPolicy = {
  currency: 'DZD',
  negotiable: true,
  minimumPrice: { type: 'percentage_of_list', percentage: 90 },
  maxDiscountPercent: 10,
  escalation: { belowMinimum: 'counter', whenNotNegotiable: 'reject', maxCounterOffers: 2 },
};

export function AgentStudio() {
  const t = useTranslations('agent');
  const searchParams = useSearchParams();
  const tab = searchParams.get('tab') ?? 'identity';

  return (
    <>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Tabs
        active={tab}
        items={[
          { id: 'identity', label: t('identityTab') },
          { id: 'knowledge', label: t('knowledgeTab') },
          { id: 'rules', label: t('rulesTab') },
        ]}
      />
      {tab === 'identity' ? <IdentityTab /> : null}
      {tab === 'knowledge' ? <KnowledgeTab /> : null}
      {tab === 'rules' ? <RulesTab /> : null}
    </>
  );
}

/* ---------- Identity & tone ---------- */

function IdentityTab() {
  const t = useTranslations('agent');
  const tc = useTranslations('common');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const store = useStore();
  const canManage = store.role === 'owner' || store.role === 'manager';
  const { toast } = useToast();

  const query = useAsyncData<AgentSettingsHistoryView>((signal) => api.get(tenant('/agent-settings'), { signal }), [api, tenant]);

  const [language, setLanguage] = useState<AgentLanguage>('ar');
  const [tone, setTone] = useState<AgentTone>('friendly');
  const [handoffNotes, setHandoffNotes] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  useEffect(() => {
    const source = query.data?.draft ?? query.data?.published;
    if (source) {
      setLanguage(source.language);
      setTone(source.tone);
      setHandoffNotes(source.handoffNotes);
    }
  }, [query.data]);

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query.data || pending) return;
    setPending(true);
    setError(null);
    try {
      await api.put(tenant('/agent-settings/draft'), {
        expectedLatestVersion: query.data.latestVersion,
        language,
        tone,
        handoffNotes: handoffNotes.trim(),
        changeNote: changeNote.trim() || null,
      });
      toast(t('draftSaved'), 'success');
      setChangeNote('');
      query.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tc('errorBody'));
    } finally {
      setPending(false);
    }
  }

  async function publish() {
    if (!query.data?.draft) return;
    await api.post(tenant(`/agent-settings/versions/${query.data.draft.id}/publish`), {
      expectedLatestVersion: query.data.latestVersion,
    });
    toast(t('published'), 'success');
    query.reload();
  }

  if (query.loading) return <Skeleton lines={6} height={18} />;
  if (query.error || !query.data) return <ErrorState onRetry={query.reload} />;

  const { draft, published, history } = query.data;

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">{t('identityTab')}</h2>
          {draft ? <Badge tone="warning">{tc('draft')}</Badge> : published ? <Badge tone="success">{tc('published')}</Badge> : null}
        </div>
        <div className="panel__body">
          {!canManage ? <InlineAlert kind="info">{t('readOnlyRole')}</InlineAlert> : null}
          {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
          <form onSubmit={saveDraft} className="stack mt-4">
            <FormField label={t('language')} required>
              <Select value={language} onChange={(e) => setLanguage(e.target.value as AgentLanguage)} disabled={!canManage}>
                <option value="ar">{t('languageAr')}</option>
                <option value="fr">{t('languageFr')}</option>
                <option value="en">English</option>
              </Select>
            </FormField>
            <FormField label={t('tone')} required>
              <Select value={tone} onChange={(e) => setTone(e.target.value as AgentTone)} disabled={!canManage}>
                <option value="professional">{t('toneFormal')}</option>
                <option value="friendly">{t('toneFriendly')}</option>
                <option value="concise">{t('toneConcise')}</option>
                <option value="warm">{t('toneWarm')}</option>
              </Select>
            </FormField>
            <FormField label={t('handoffNotes')} hint={t('handoffNotesHint')}>
              <Textarea value={handoffNotes} onChange={(e) => setHandoffNotes(e.target.value)} rows={4} maxLength={1000} disabled={!canManage} />
            </FormField>
            <FormField label={t('changeNote')} hint={t('changeNoteHint')}>
              <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} maxLength={500} disabled={!canManage} />
            </FormField>
            {canManage ? (
              <div className="form-actions">
                <Button type="submit" variant="secondary" loading={pending}>
                  {t('saveDraft')}
                </Button>
                <Button type="button" onClick={() => setConfirmPublish(true)} disabled={!draft}>
                  {t('publishSettings')}
                </Button>
              </div>
            ) : null}
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel__header">
          <h2 className="panel__title">{t('historyTitle')}</h2>
        </div>
        <div className="panel__body">
          {!published ? <InlineAlert kind="info">{t('noPublished')}</InlineAlert> : null}
          <ul className="stack" style={{ gap: 12, marginTop: 12 }}>
            {history.map((version) => (
              <li key={version.id} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <strong className="num">{t('versionLabel', { version: version.version })}</strong>
                <Badge tone={version.status === 'published' ? 'success' : version.status === 'draft' ? 'warning' : 'neutral'}>
                  {version.status === 'published' ? tc('published') : version.status === 'draft' ? tc('draft') : tc('superseded')}
                </Badge>
                <span className="meta-text">{formatDateTime(version.createdAt, locale)}</span>
                {version.changeNote ? <span className="meta-text" dir="auto">· {version.changeNote}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <ConfirmDialog
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        onConfirm={publish}
        title={t('publishTitle')}
        body={t('publishBody')}
        confirmLabel={t('publishSettings')}
      />
    </div>
  );
}

/* ---------- Knowledge ---------- */

function KnowledgeTab() {
  const t = useTranslations('agent');
  const tc = useTranslations('common');
  const locale = useLocale();
  const api = useApi();
  const tenant = useTenantPath();
  const store = useStore();
  const canManage = store.role === 'owner' || store.role === 'manager';
  const { toast } = useToast();

  const query = useAsyncData<KnowledgeEntryView[]>((signal) => api.get(tenant('/knowledge?limit=100'), { signal }), [api, tenant]);
  const [createOpen, setCreateOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<KnowledgeEntryView | null>(null);

  async function publish(entry: KnowledgeEntryView) {
    const draft = entry.draft;
    if (!draft) return;
    await api.post(tenant(`/knowledge/${entry.id}/versions/${draft.id}/publish`), { expectedEntryVersion: entry.version });
    toast(t('entryPublished'), 'success');
    query.reload();
  }

  return (
    <>
      <div className="filter-bar" style={{ justifyContent: 'space-between' }}>
        <p className="meta-text" style={{ margin: 0, maxWidth: '60ch' }}>
          {t('knowledgeSubtitle')}
        </p>
        {canManage ? (
          <Button onClick={() => setCreateOpen(true)} icon={<Icon name="plus" size={16} />}>
            {t('addEntry')}
          </Button>
        ) : null}
      </div>

      {query.loading ? (
        <div className="panel"><div className="panel__body"><Skeleton lines={5} height={18} /></div></div>
      ) : query.error ? (
        <ErrorState onRetry={query.reload} />
      ) : (query.data ?? []).length === 0 ? (
        <div className="panel">
          <EmptyState icon="info" title={t('knowledgeEmpty')} />
        </div>
      ) : (
        <div className="section-stack">
          {(query.data ?? []).map((entry) => (
            <section key={entry.id} className="panel">
              <div className="panel__header">
                <div>
                  <h3 className="panel__title" dir="auto">
                    {(entry.draft ?? entry.published)?.title ?? entry.slug}
                  </h3>
                  <p className="meta-text" dir="ltr" style={{ textAlign: 'start' }}>
                    {entry.slug} · {t(`kind${entry.kind === 'faq' ? 'Faq' : entry.kind === 'article' ? 'Article' : 'Policy'}`)}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {entry.draft ? <Badge tone="warning">{tc('draft')}</Badge> : null}
                  {entry.published ? <Badge tone="success">{t('versionLabel', { version: entry.published.version })}</Badge> : null}
                  {canManage && entry.draft ? (
                    <Button size="sm" variant="secondary" onClick={() => setPublishTarget(entry)}>
                      {tc('publish')}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="panel__body">
                <p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {(entry.draft ?? entry.published)?.content ?? ''}
                </p>
                <p className="meta-text mt-4">{formatDateTime(entry.updatedAt, locale)}</p>
              </div>
            </section>
          ))}
        </div>
      )}

      <KnowledgeCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => query.reload()} />
      <ConfirmDialog
        open={publishTarget !== null}
        onClose={() => setPublishTarget(null)}
        onConfirm={async () => { if (publishTarget) await publish(publishTarget); }}
        title={t('entryPublished')}
        body={t('publishBody')}
        confirmLabel={tc('publish')}
      />
    </>
  );
}

function KnowledgeCreateDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('agent');
  const tc = useTranslations('common');
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();
  const [slug, setSlug] = useState('');
  const [kind, setKind] = useState<KnowledgeKind>('faq');
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await api.post(tenant('/knowledge'), {
        slug: slug.trim(),
        kind,
        title: title.trim(),
        question: question.trim() || null,
        content: content.trim(),
      });
      toast(t('entryCreated'), 'success');
      onClose();
      onDone();
      setSlug('');
      setTitle('');
      setQuestion('');
      setContent('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tc('errorBody'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('addEntry')} wide>
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      <form onSubmit={submit} className="stack mt-4">
        <div className="form-grid">
          <FormField label={t('entrySlug')} required hint={t('slugHint')}>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} required minLength={2} maxLength={100} dir="ltr" style={{ textAlign: 'start' }} />
          </FormField>
          <FormField label={t('entryKind')} required>
            <Select value={kind} onChange={(e) => setKind(e.target.value as KnowledgeKind)}>
              <option value="faq">{t('kindFaq')}</option>
              <option value="article">{t('kindArticle')}</option>
              <option value="policy">{t('kindPolicy')}</option>
            </Select>
          </FormField>
        </div>
        <FormField label={t('entryTitle')} required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </FormField>
        <FormField label={t('entryQuestion')}>
          <Input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} />
        </FormField>
        <FormField label={t('entryContent')} required>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} required rows={6} maxLength={20000} />
        </FormField>
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={pending}>
            {t('addEntry')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ---------- Pricing rules ---------- */

function RulesTab() {
  const t = useTranslations('agent');
  const tc = useTranslations('common');
  const api = useApi();
  const tenant = useTenantPath();
  const store = useStore();
  const canManage = store.role === 'owner' || store.role === 'manager';
  const { toast } = useToast();
  const locale = useLocale();

  const query = useAsyncData<BusinessRuleSetView[]>((signal) => api.get(tenant('/rule-sets?limit=100'), { signal }), [api, tenant]);
  const [createOpen, setCreateOpen] = useState(false);
  const [publishTarget, setPublishTarget] = useState<BusinessRuleSetView | null>(null);

  async function publish(ruleSet: BusinessRuleSetView) {
    if (!ruleSet.draft) return;
    await api.post(tenant(`/rule-sets/${ruleSet.id}/versions/${ruleSet.draft.id}/publish`), { expectedSetVersion: ruleSet.version });
    toast(t('rulePublished'), 'success');
    query.reload();
  }

  const policySummary = useMemo(
    () => (ruleSet: BusinessRuleSetView): string => {
      const policy = (ruleSet.draft ?? ruleSet.published)?.policy;
      if (!policy) return '—';
      const min =
        policy.minimumPrice.type === 'fixed'
          ? `${policy.minimumPrice.amount} ${policy.currency}`
          : `${policy.minimumPrice.percentage}%`;
      return `${min} · ${policy.maxDiscountPercent}%`;
    },
    [],
  );

  return (
    <>
      <div className="filter-bar" style={{ justifyContent: 'space-between' }}>
        <p className="meta-text" style={{ margin: 0, maxWidth: '60ch' }}>
          {t('rulesSubtitle')}
        </p>
        {canManage ? (
          <Button onClick={() => setCreateOpen(true)} icon={<Icon name="plus" size={16} />}>
            {t('addRuleSet')}
          </Button>
        ) : null}
      </div>

      {query.loading ? (
        <div className="panel"><div className="panel__body"><Skeleton lines={4} height={18} /></div></div>
      ) : query.error ? (
        <ErrorState onRetry={query.reload} />
      ) : (query.data ?? []).length === 0 ? (
        <div className="panel">
          <EmptyState icon="settings" title={t('rulesEmpty')} />
        </div>
      ) : (
        <div className="section-stack">
          {(query.data ?? []).map((ruleSet) => (
            <section key={ruleSet.id} className="panel">
              <div className="panel__header">
                <div>
                  <h3 className="panel__title" dir="auto">{ruleSet.name}</h3>
                  <p className="meta-text" dir="ltr" style={{ textAlign: 'start' }}>{ruleSet.key}</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {ruleSet.draft ? <Badge tone="warning">{tc('draft')}</Badge> : null}
                  {ruleSet.published ? <Badge tone="success">{t('versionLabel', { version: ruleSet.published.version })}</Badge> : null}
                  {canManage && ruleSet.draft ? (
                    <Button size="sm" variant="secondary" onClick={() => setPublishTarget(ruleSet)}>
                      {tc('publish')}
                    </Button>
                  ) : null}
                </div>
              </div>
              <div className="panel__body">
                <dl className="detail-list">
                  <dt>{t('negotiable')}</dt>
                  <dd>{(ruleSet.draft ?? ruleSet.published)?.policy.negotiable ? tc('yes') : tc('no')}</dd>
                  <dt>{t('minPriceType')}</dt>
                  <dd className="num">{policySummary(ruleSet)}</dd>
                  <dt>{tc('updatedAt')}</dt>
                  <dd>{formatDateTime(ruleSet.updatedAt, locale)}</dd>
                </dl>
                {ruleSet.description ? <p className="meta-text mt-4" dir="auto">{ruleSet.description}</p> : null}
              </div>
            </section>
          ))}
        </div>
      )}

      <RuleSetCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onDone={() => query.reload()} />
      <ConfirmDialog
        open={publishTarget !== null}
        onClose={() => setPublishTarget(null)}
        onConfirm={async () => { if (publishTarget) await publish(publishTarget); }}
        title={t('publishSettings')}
        body={t('publishBody')}
        confirmLabel={tc('publish')}
      />
    </>
  );
}

function RuleSetCreateDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('agent');
  const tc = useTranslations('common');
  const api = useApi();
  const tenant = useTenantPath();
  const { toast } = useToast();
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [policy, setPolicy] = useState<PricingPolicy>(DEFAULT_POLICY);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      await api.post(tenant('/rule-sets'), {
        key: key.trim(),
        name: name.trim(),
        description: null,
        policy,
        changeNote: null,
      });
      toast(t('ruleCreated'), 'success');
      onClose();
      onDone();
      setKey('');
      setName('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : tc('errorBody'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('addRuleSet')} wide>
      {error ? <InlineAlert kind="error">{error}</InlineAlert> : null}
      <form onSubmit={submit} className="stack mt-4">
        <div className="form-grid">
          <FormField label={t('ruleKey')} required>
            <Input value={key} onChange={(e) => setKey(e.target.value)} required dir="ltr" style={{ textAlign: 'start' }} placeholder="default-pricing" />
          </FormField>
          <FormField label={t('ruleName')} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </FormField>
          <FormField label={tc('currency')} required>
            <Input
              value={policy.currency}
              onChange={(e) => setPolicy({ ...policy, currency: e.target.value.toUpperCase() })}
              maxLength={3}
              minLength={3}
              required
              dir="ltr"
              style={{ textAlign: 'start', width: 110 }}
            />
          </FormField>
          <FormField label={t('maxDiscount')} required>
            <Input
              type="number"
              min={0}
              max={100}
              value={policy.maxDiscountPercent}
              onChange={(e) => setPolicy({ ...policy, maxDiscountPercent: Number(e.target.value) })}
              required
              dir="ltr"
              style={{ textAlign: 'end' }}
            />
          </FormField>
          <FormField label={t('minPercent')} required>
            <Input
              type="number"
              min={0}
              max={100}
              value={policy.minimumPrice.type === 'percentage_of_list' ? policy.minimumPrice.percentage : 90}
              onChange={(e) => setPolicy({ ...policy, minimumPrice: { type: 'percentage_of_list', percentage: Number(e.target.value) } })}
              required
              dir="ltr"
              style={{ textAlign: 'end' }}
            />
          </FormField>
        </div>
        <Checkbox
          label={t('negotiable')}
          checked={policy.negotiable}
          onChange={(e) => setPolicy({ ...policy, negotiable: e.target.checked })}
        />
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {tc('cancel')}
          </Button>
          <Button type="submit" loading={pending}>
            {t('addRuleSet')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
