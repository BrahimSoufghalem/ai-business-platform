const foundations = [
  'عزل المتاجر والصلاحيات',
  'كتالوج ومنتجات ديناميكية',
  'مخزون وطلبات موثوقة',
  'AI Agent يعمل عبر أدوات مضبوطة',
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <span className="eyebrow">MVP FOUNDATION</span>
        <h1>AI Business Platform</h1>
        <p>
          نظام تشغيل للتاجر تكون فيه البيانات والقواعد مصدر الحقيقة، ويعمل الذكاء الاصطناعي كطبقة
          فهم وتواصل فقط.
        </p>
        <div className="status">
          <span className="dot" aria-hidden="true" />
          MVP الداخلي جاهز للـPilot الاصطناعي
        </div>
        <a className="primary-link" href="/inbox">
          فتح الصندوق الداخلي
        </a>
        <a className="secondary-link" href="/settings/configuration">
          مركز القواعد والمعرفة
        </a>
        <a className="secondary-link" href="/settings/product-types">
          أنواع المنتجات
        </a>
        <a className="secondary-link" href="/dashboard">
          لوحة تشغيل Pilot
        </a>
      </section>

      <section className="grid" aria-label="أسس المنصة">
        {foundations.map((item, index) => (
          <article className="card" key={item}>
            <span>0{index + 1}</span>
            <h2>{item}</h2>
          </article>
        ))}
      </section>

      <footer>قناة الـPilot الأولى: Instagram</footer>
    </main>
  );
}
