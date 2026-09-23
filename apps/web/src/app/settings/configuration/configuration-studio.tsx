'use client';

import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

type VersionStatus = 'draft' | 'published' | 'superseded';
type Tab = 'rules' | 'knowledge' | 'agent';

interface RuleVersion {
  id: string;
  version: number;
  status: VersionStatus;
  policy: {
    currency: string;
    negotiable: boolean;
    minimumPrice:
      { type: 'fixed'; amount: string } | { type: 'percentage_of_list'; percentage: number };
    maxDiscountPercent: number;
    escalation: {
      belowMinimum: 'counter' | 'handoff' | 'reject';
      whenNotNegotiable: 'handoff' | 'reject';
      maxCounterOffers: number;
    };
  };
  changeNote: string | null;
  createdAt: string;
}

interface RuleSet {
  id: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
  draft: RuleVersion | null;
  published: RuleVersion | null;
  history: RuleVersion[];
}

interface KnowledgeVersion {
  id: string;
  version: number;
  status: VersionStatus;
  title: string;
  question: string | null;
  content: string;
  changeNote: string | null;
  createdAt: string;
}

interface KnowledgeEntry {
  id: string;
  slug: string;
  kind: 'faq' | 'article' | 'policy';
  version: number;
  draft: KnowledgeVersion | null;
  published: KnowledgeVersion | null;
  history: KnowledgeVersion[];
}

interface AgentVersion {
  id: string;
  version: number;
  status: VersionStatus;
  language: 'ar' | 'fr' | 'en';
  tone: 'professional' | 'friendly' | 'concise' | 'warm';
  handoffNotes: string;
  changeNote: string | null;
  createdAt: string;
}

interface AgentHistory {
  latestVersion: number;
  draft: AgentVersion | null;
  published: AgentVersion | null;
  history: AgentVersion[];
}

const emptyRule = {
  key: '',
  name: '',
  description: '',
  currency: 'DZD',
  negotiable: true,
  minimumType: 'percentage_of_list' as 'fixed' | 'percentage_of_list',
  minimumValue: '85',
  maxDiscountPercent: '10',
  belowMinimum: 'counter' as 'counter' | 'handoff' | 'reject',
  whenNotNegotiable: 'handoff' as 'handoff' | 'reject',
  maxCounterOffers: '2',
  changeNote: '',
};

const emptyKnowledge = {
  slug: '',
  kind: 'faq' as 'faq' | 'article' | 'policy',
  title: '',
  question: '',
  content: '',
  changeNote: '',
};

const statusLabels: Record<VersionStatus, string> = {
  draft: 'مسودة',
  published: 'منشور',
  superseded: 'سابق',
};

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat('ar-DZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function ConfigurationStudio() {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001/api';
  const [tenantInput, setTenantInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [connection, setConnection] = useState<{ tenantId: string; token: string } | null>(null);
  const [tab, setTab] = useState<Tab>('rules');
  const [rules, setRules] = useState<RuleSet[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeEntry[]>([]);
  const [agent, setAgent] = useState<AgentHistory>({
    latestVersion: 0,
    draft: null,
    published: null,
    history: [],
  });
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState(emptyRule);
  const [knowledgeForm, setKnowledgeForm] = useState(emptyKnowledge);
  const [agentForm, setAgentForm] = useState({
    language: 'ar' as 'ar' | 'fr' | 'en',
    tone: 'friendly' as 'professional' | 'friendly' | 'concise' | 'warm',
    handoffNotes: '',
    changeNote: '',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedRule = useMemo(
    () => rules.find((item) => item.id === selectedRuleId) ?? null,
    [rules, selectedRuleId],
  );
  const selectedKnowledge = useMemo(
    () => knowledge.find((item) => item.id === selectedKnowledgeId) ?? null,
    [knowledge, selectedKnowledgeId],
  );

  const request = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (!connection) throw new Error('أدخل بيانات الاتصال أولًا.');
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${connection.token}`,
          'Content-Type': 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
          ...init?.headers,
        },
        cache: 'no-store',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const message = Array.isArray(body?.message) ? body.message.join('، ') : body?.message;
        throw new Error(message ?? `تعذّر تنفيذ الطلب (${response.status}).`);
      }
      return (await response.json()) as T;
    },
    [apiBaseUrl, connection],
  );

  const refresh = useCallback(async (): Promise<void> => {
    if (!connection) return;
    setPending(true);
    setError(null);
    try {
      const root = `/tenants/${connection.tenantId}`;
      const [nextRules, nextKnowledge, nextAgent] = await Promise.all([
        request<RuleSet[]>(`${root}/rule-sets?limit=100`),
        request<KnowledgeEntry[]>(`${root}/knowledge?limit=100`),
        request<AgentHistory>(`${root}/agent-settings`),
      ]);
      setRules(nextRules);
      setKnowledge(nextKnowledge);
      setAgent(nextAgent);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر تحميل الإعدادات.');
    } finally {
      setPending(false);
    }
  }, [connection, request]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function connect(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    if (!/^[0-9a-f-]{36}$/i.test(tenantInput.trim()) || tokenInput.trim().length < 10) {
      setError('تحقق من معرّف المتجر ورمز الدخول.');
      return;
    }
    setConnection({ tenantId: tenantInput.trim(), token: tokenInput.trim() });
    setTokenInput('');
  }

  function editRule(item: RuleSet | null): void {
    setSelectedRuleId(item?.id ?? null);
    if (!item) {
      setRuleForm(emptyRule);
      return;
    }
    const version = item.draft ?? item.published;
    if (!version) return;
    setRuleForm({
      key: item.key,
      name: item.name,
      description: item.description ?? '',
      currency: version.policy.currency,
      negotiable: version.policy.negotiable,
      minimumType: version.policy.minimumPrice.type,
      minimumValue:
        version.policy.minimumPrice.type === 'fixed'
          ? version.policy.minimumPrice.amount
          : String(version.policy.minimumPrice.percentage),
      maxDiscountPercent: String(version.policy.maxDiscountPercent),
      belowMinimum: version.policy.escalation.belowMinimum,
      whenNotNegotiable: version.policy.escalation.whenNotNegotiable,
      maxCounterOffers: String(version.policy.escalation.maxCounterOffers),
      changeNote: '',
    });
  }

  async function saveRule(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!connection) return;
    setPending(true);
    setError(null);
    setNotice(null);
    const policy = {
      currency: ruleForm.currency,
      negotiable: ruleForm.negotiable,
      minimumPrice:
        ruleForm.minimumType === 'fixed'
          ? { type: 'fixed' as const, amount: ruleForm.minimumValue }
          : {
              type: 'percentage_of_list' as const,
              percentage: Number(ruleForm.minimumValue),
            },
      maxDiscountPercent: Number(ruleForm.maxDiscountPercent),
      escalation: {
        belowMinimum: ruleForm.belowMinimum,
        whenNotNegotiable: ruleForm.whenNotNegotiable,
        maxCounterOffers: Number(ruleForm.maxCounterOffers),
      },
    };
    try {
      const root = `/tenants/${connection.tenantId}/rule-sets`;
      const result = selectedRule
        ? await request<RuleSet>(`${root}/${selectedRule.id}/draft`, {
            method: 'PUT',
            body: JSON.stringify({
              expectedSetVersion: selectedRule.version,
              policy,
              changeNote: ruleForm.changeNote || null,
            }),
          })
        : await request<RuleSet>(root, {
            method: 'POST',
            body: JSON.stringify({
              key: ruleForm.key,
              name: ruleForm.name,
              description: ruleForm.description || null,
              policy,
              changeNote: ruleForm.changeNote || null,
            }),
          });
      setSelectedRuleId(result.id);
      setNotice('حُفظ إصدار مسودة جديد. لن يستخدمه الوكيل قبل النشر.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر حفظ القاعدة.');
    } finally {
      setPending(false);
    }
  }

  async function publishRule(): Promise<void> {
    if (!connection || !selectedRule?.draft) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await request(
        `/tenants/${connection.tenantId}/rule-sets/${selectedRule.id}/versions/${selectedRule.draft.id}/publish`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedSetVersion: selectedRule.version }),
        },
      );
      setNotice(`نُشرت القاعدة بالإصدار ${selectedRule.draft.version}.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر نشر القاعدة.');
    } finally {
      setPending(false);
    }
  }

  function editKnowledge(item: KnowledgeEntry | null): void {
    setSelectedKnowledgeId(item?.id ?? null);
    if (!item) {
      setKnowledgeForm(emptyKnowledge);
      return;
    }
    const version = item.draft ?? item.published;
    if (!version) return;
    setKnowledgeForm({
      slug: item.slug,
      kind: item.kind,
      title: version.title,
      question: version.question ?? '',
      content: version.content,
      changeNote: '',
    });
  }

  async function saveKnowledge(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!connection) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const root = `/tenants/${connection.tenantId}/knowledge`;
      const result = selectedKnowledge
        ? await request<KnowledgeEntry>(`${root}/${selectedKnowledge.id}/draft`, {
            method: 'PUT',
            body: JSON.stringify({
              expectedEntryVersion: selectedKnowledge.version,
              title: knowledgeForm.title,
              question: knowledgeForm.question || null,
              content: knowledgeForm.content,
              changeNote: knowledgeForm.changeNote || null,
            }),
          })
        : await request<KnowledgeEntry>(root, {
            method: 'POST',
            body: JSON.stringify({
              slug: knowledgeForm.slug,
              kind: knowledgeForm.kind,
              title: knowledgeForm.title,
              question: knowledgeForm.question || null,
              content: knowledgeForm.content,
              changeNote: knowledgeForm.changeNote || null,
            }),
          });
      setSelectedKnowledgeId(result.id);
      setNotice('حُفظت مسودة معرفة جديدة، وهي غير متاحة للوكيل بعد.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر حفظ المعرفة.');
    } finally {
      setPending(false);
    }
  }

  async function publishKnowledge(): Promise<void> {
    if (!connection || !selectedKnowledge?.draft) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await request(
        `/tenants/${connection.tenantId}/knowledge/${selectedKnowledge.id}/versions/${selectedKnowledge.draft.id}/publish`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedEntryVersion: selectedKnowledge.version }),
        },
      );
      setNotice(`نُشرت المعرفة بالإصدار ${selectedKnowledge.draft.version}.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر نشر المعرفة.');
    } finally {
      setPending(false);
    }
  }

  async function saveAgent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!connection) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await request(`/tenants/${connection.tenantId}/agent-settings/draft`, {
        method: 'PUT',
        body: JSON.stringify({
          expectedLatestVersion: agent.latestVersion,
          ...agentForm,
          changeNote: agentForm.changeNote || null,
        }),
      });
      setNotice('حُفظت إعدادات الوكيل كمسودة آمنة.');
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر حفظ إعدادات الوكيل.');
    } finally {
      setPending(false);
    }
  }

  async function publishAgent(): Promise<void> {
    if (!connection || !agent.draft) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await request(
        `/tenants/${connection.tenantId}/agent-settings/versions/${agent.draft.id}/publish`,
        {
          method: 'POST',
          body: JSON.stringify({ expectedLatestVersion: agent.latestVersion }),
        },
      );
      setNotice(`نُشرت إعدادات الوكيل بالإصدار ${agent.draft.version}.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذّر نشر إعدادات الوكيل.');
    } finally {
      setPending(false);
    }
  }

  function loadAgentVersion(version: AgentVersion | null): void {
    if (!version) return;
    setAgentForm({
      language: version.language,
      tone: version.tone,
      handoffNotes: version.handoffNotes,
      changeNote: '',
    });
  }

  if (!connection) {
    return (
      <main className="inbox-login">
        <form className="connect-card" onSubmit={connect}>
          <span className="eyebrow">POLICY STUDIO</span>
          <h1>القواعد والمعرفة</h1>
          <p>أدخل متجر الاختبار ورمز الدخول. يبقى الرمز في ذاكرة الصفحة ولا يُحفظ في المتصفح.</p>
          <label>
            معرّف المتجر
            <input
              dir="ltr"
              autoComplete="off"
              value={tenantInput}
              onChange={(event) => setTenantInput(event.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <label>
            رمز الدخول
            <input
              dir="ltr"
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="Bearer token"
            />
          </label>
          {error ? <p className="error-banner">{error}</p> : null}
          <button type="submit">فتح مركز الإعداد</button>
          <a href="/">العودة إلى الرئيسية</a>
        </form>
      </main>
    );
  }

  return (
    <main className="config-shell">
      <header className="config-header">
        <div>
          <span className="eyebrow">VERSIONED CONFIGURATION</span>
          <h1>مركز القواعد والمعرفة</h1>
          <p>كل تغيير مسودة مستقلة، ولا يصل للوكيل إلا بعد نشر صريح.</p>
        </div>
        <div className="product-type-header-actions">
          <a className="ghost-link" href="/settings/product-types">
            أنواع المنتجات
          </a>
          <button className="ghost-button" type="button" onClick={() => void refresh()}>
            تحديث
          </button>
        </div>
      </header>

      <nav className="config-tabs" aria-label="أقسام الإعداد">
        <button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}>
          قواعد التسعير
        </button>
        <button className={tab === 'knowledge' ? 'active' : ''} onClick={() => setTab('knowledge')}>
          المعرفة وFAQ
        </button>
        <button className={tab === 'agent' ? 'active' : ''} onClick={() => setTab('agent')}>
          إعدادات الوكيل
        </button>
      </nav>

      {error ? <p className="error-banner">{error}</p> : null}
      {notice ? <p className="notice-banner">{notice}</p> : null}

      {tab === 'rules' ? (
        <section className="config-grid">
          <aside className="config-list">
            <button className="new-record" type="button" onClick={() => editRule(null)}>
              + قاعدة جديدة
            </button>
            {rules.map((item) => (
              <button
                type="button"
                key={item.id}
                className={selectedRuleId === item.id ? 'selected' : ''}
                onClick={() => editRule(item)}
              >
                <b>{item.name}</b>
                <span>{item.key}</span>
                <small>
                  {item.draft ? 'مسودة جاهزة' : 'بلا مسودة'} ·{' '}
                  {item.published ? `منشور v${item.published.version}` : 'غير منشور'}
                </small>
              </button>
            ))}
          </aside>
          <div className="config-editor">
            <form className="config-form" onSubmit={(event) => void saveRule(event)}>
              <div className="form-title">
                <div>
                  <h2>{selectedRule ? selectedRule.name : 'قاعدة تسعير جديدة'}</h2>
                  <p>حقول Typed فقط؛ لا يقبل النظام كودًا أو تعبيرات تنفيذية.</p>
                </div>
                {selectedRule?.draft ? (
                  <button type="button" disabled={pending} onClick={() => void publishRule()}>
                    نشر v{selectedRule.draft.version}
                  </button>
                ) : null}
              </div>
              <div className="form-columns">
                <label>
                  المفتاح
                  <input
                    dir="ltr"
                    value={ruleForm.key}
                    disabled={selectedRule !== null}
                    onChange={(event) =>
                      setRuleForm((current) => ({ ...current, key: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  الاسم
                  <input
                    value={ruleForm.name}
                    disabled={selectedRule !== null}
                    onChange={(event) =>
                      setRuleForm((current) => ({ ...current, name: event.target.value }))
                    }
                    required
                  />
                </label>
                <label>
                  العملة
                  <input
                    dir="ltr"
                    value={ruleForm.currency}
                    maxLength={3}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        currency: event.target.value.toUpperCase(),
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  أقصى خصم %
                  <input
                    dir="ltr"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={ruleForm.maxDiscountPercent}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        maxDiscountPercent: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  نوع الحد الأدنى
                  <select
                    value={ruleForm.minimumType}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        minimumType: event.target.value as 'fixed' | 'percentage_of_list',
                      }))
                    }
                  >
                    <option value="percentage_of_list">نسبة من سعر القائمة</option>
                    <option value="fixed">مبلغ ثابت</option>
                  </select>
                </label>
                <label>
                  قيمة الحد الأدنى
                  <input
                    dir="ltr"
                    type="number"
                    min="0"
                    step="0.01"
                    value={ruleForm.minimumValue}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        minimumValue: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  تحت الحد
                  <select
                    value={ruleForm.belowMinimum}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        belowMinimum: event.target.value as 'counter' | 'handoff' | 'reject',
                      }))
                    }
                  >
                    <option value="counter">عرض مضاد</option>
                    <option value="handoff">تحويل لموظف</option>
                    <option value="reject">رفض</option>
                  </select>
                </label>
                <label>
                  عند منع التفاوض
                  <select
                    value={ruleForm.whenNotNegotiable}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        whenNotNegotiable: event.target.value as 'handoff' | 'reject',
                      }))
                    }
                  >
                    <option value="handoff">تحويل لموظف</option>
                    <option value="reject">رفض</option>
                  </select>
                </label>
                <label>
                  أقصى عروض مضادة
                  <input
                    dir="ltr"
                    type="number"
                    min="0"
                    max="10"
                    value={ruleForm.maxCounterOffers}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        maxCounterOffers: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={ruleForm.negotiable}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        negotiable: event.target.checked,
                      }))
                    }
                  />
                  قابل للتفاوض
                </label>
              </div>
              {!selectedRule ? (
                <label>
                  الوصف
                  <textarea
                    value={ruleForm.description}
                    onChange={(event) =>
                      setRuleForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}
              <label>
                ملاحظة التغيير
                <input
                  value={ruleForm.changeNote}
                  onChange={(event) =>
                    setRuleForm((current) => ({ ...current, changeNote: event.target.value }))
                  }
                />
              </label>
              <button type="submit" disabled={pending}>
                {selectedRule ? 'حفظ إصدار مسودة جديد' : 'إنشاء المسودة'}
              </button>
            </form>
            <VersionHistory versions={selectedRule?.history ?? []} />
          </div>
        </section>
      ) : null}

      {tab === 'knowledge' ? (
        <section className="config-grid">
          <aside className="config-list">
            <button className="new-record" type="button" onClick={() => editKnowledge(null)}>
              + محتوى جديد
            </button>
            {knowledge.map((item) => (
              <button
                type="button"
                key={item.id}
                className={selectedKnowledgeId === item.id ? 'selected' : ''}
                onClick={() => editKnowledge(item)}
              >
                <b>{item.draft?.title ?? item.published?.title ?? item.slug}</b>
                <span>{item.kind}</span>
                <small>
                  {item.draft ? 'مسودة جاهزة' : 'بلا مسودة'} ·{' '}
                  {item.published ? `منشور v${item.published.version}` : 'غير منشور'}
                </small>
              </button>
            ))}
          </aside>
          <div className="config-editor">
            <form className="config-form" onSubmit={(event) => void saveKnowledge(event)}>
              <div className="form-title">
                <div>
                  <h2>{selectedKnowledge ? 'تحرير المعرفة' : 'محتوى معرفة جديد'}</h2>
                  <p>المحتوى المسترجع يُوسم كبيانات غير موثوقة، وليس تعليمات للنموذج.</p>
                </div>
                {selectedKnowledge?.draft ? (
                  <button type="button" disabled={pending} onClick={() => void publishKnowledge()}>
                    نشر v{selectedKnowledge.draft.version}
                  </button>
                ) : null}
              </div>
              <div className="form-columns">
                <label>
                  Slug
                  <input
                    dir="ltr"
                    value={knowledgeForm.slug}
                    disabled={selectedKnowledge !== null}
                    onChange={(event) =>
                      setKnowledgeForm((current) => ({
                        ...current,
                        slug: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <label>
                  النوع
                  <select
                    value={knowledgeForm.kind}
                    disabled={selectedKnowledge !== null}
                    onChange={(event) =>
                      setKnowledgeForm((current) => ({
                        ...current,
                        kind: event.target.value as 'faq' | 'article' | 'policy',
                      }))
                    }
                  >
                    <option value="faq">FAQ</option>
                    <option value="article">مقال</option>
                    <option value="policy">سياسة</option>
                  </select>
                </label>
              </div>
              <label>
                العنوان
                <input
                  value={knowledgeForm.title}
                  onChange={(event) =>
                    setKnowledgeForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                السؤال
                <input
                  value={knowledgeForm.question}
                  onChange={(event) =>
                    setKnowledgeForm((current) => ({
                      ...current,
                      question: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                المحتوى
                <textarea
                  className="content-editor"
                  value={knowledgeForm.content}
                  onChange={(event) =>
                    setKnowledgeForm((current) => ({
                      ...current,
                      content: event.target.value,
                    }))
                  }
                  required
                />
              </label>
              <label>
                ملاحظة التغيير
                <input
                  value={knowledgeForm.changeNote}
                  onChange={(event) =>
                    setKnowledgeForm((current) => ({
                      ...current,
                      changeNote: event.target.value,
                    }))
                  }
                />
              </label>
              <button type="submit" disabled={pending}>
                {selectedKnowledge ? 'حفظ إصدار مسودة جديد' : 'إنشاء المسودة'}
              </button>
            </form>
            <VersionHistory versions={selectedKnowledge?.history ?? []} />
          </div>
        </section>
      ) : null}

      {tab === 'agent' ? (
        <section className="config-editor agent-editor">
          <form className="config-form" onSubmit={(event) => void saveAgent(event)}>
            <div className="form-title">
              <div>
                <h2>إعدادات الوكيل الآمنة</h2>
                <p>لغة ونبرة وملاحظات تحويل فقط؛ لا يوجد حقل System Prompt قابل للتعديل.</p>
              </div>
              {agent.draft ? (
                <button type="button" disabled={pending} onClick={() => void publishAgent()}>
                  نشر v{agent.draft.version}
                </button>
              ) : null}
            </div>
            <div className="form-columns">
              <label>
                اللغة
                <select
                  value={agentForm.language}
                  onChange={(event) =>
                    setAgentForm((current) => ({
                      ...current,
                      language: event.target.value as 'ar' | 'fr' | 'en',
                    }))
                  }
                >
                  <option value="ar">العربية</option>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label>
                النبرة
                <select
                  value={agentForm.tone}
                  onChange={(event) =>
                    setAgentForm((current) => ({
                      ...current,
                      tone: event.target.value as 'professional' | 'friendly' | 'concise' | 'warm',
                    }))
                  }
                >
                  <option value="professional">احترافية</option>
                  <option value="friendly">ودّية</option>
                  <option value="concise">مختصرة</option>
                  <option value="warm">دافئة</option>
                </select>
              </label>
            </div>
            <label>
              ملاحظات التحويل
              <textarea
                className="content-editor"
                maxLength={1000}
                value={agentForm.handoffNotes}
                onChange={(event) =>
                  setAgentForm((current) => ({
                    ...current,
                    handoffNotes: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              ملاحظة التغيير
              <input
                value={agentForm.changeNote}
                onChange={(event) =>
                  setAgentForm((current) => ({
                    ...current,
                    changeNote: event.target.value,
                  }))
                }
              />
            </label>
            <button type="submit" disabled={pending}>
              حفظ إصدار مسودة جديد
            </button>
          </form>
          <div className="agent-preview">
            <div>
              <span>المنشور حاليًا</span>
              <b>
                {agent.published
                  ? `${agent.published.language} · ${agent.published.tone} · v${agent.published.version}`
                  : 'لا يوجد'}
              </b>
            </div>
            <div>
              <span>المسودة</span>
              <b>{agent.draft ? `v${agent.draft.version}` : 'لا توجد'}</b>
            </div>
          </div>
          <div className="version-history">
            <h3>سجل التغيير</h3>
            {agent.history.map((version) => (
              <button type="button" key={version.id} onClick={() => loadAgentVersion(version)}>
                <span className={`version-status ${version.status}`}>
                  {statusLabels[version.status]}
                </span>
                <b>v{version.version}</b>
                <small>{version.changeNote ?? 'بلا ملاحظة'}</small>
                <time>{dateLabel(version.createdAt)}</time>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function VersionHistory({ versions }: { versions: readonly (RuleVersion | KnowledgeVersion)[] }) {
  return (
    <div className="version-history">
      <h3>المعاينة وسجل التغيير</h3>
      {versions.map((version) => (
        <article key={version.id}>
          <span className={`version-status ${version.status}`}>{statusLabels[version.status]}</span>
          <b>v{version.version}</b>
          <small>{version.changeNote ?? 'بلا ملاحظة'}</small>
          <time>{dateLabel(version.createdAt)}</time>
          {'content' in version ? (
            <p>{version.content.slice(0, 220)}</p>
          ) : (
            <pre>{JSON.stringify(version.policy, null, 2)}</pre>
          )}
        </article>
      ))}
      {versions.length === 0 ? <p className="empty-state">لا توجد إصدارات بعد.</p> : null}
    </div>
  );
}
