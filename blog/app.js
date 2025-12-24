(async () => {
  const q = new URLSearchParams(location.search);
  const tag = q.get("tag");

  const tEl = document.getElementById("pageTitle");
  if (tEl) tEl.textContent = tag ? `Posts: ${tag}` : "Recent Posts";

  const r = await fetch("./posts.json", { cache: "no-store" });
  if (!r.ok) {
    const el = document.getElementById("postList");
    if (el) el.innerHTML = "<p>posts.json을 불러오지 못했다.</p>";
    return;
  }

  const d = await r.json();
  const el = document.getElementById("postList");
  if (!el) return;

  const ps = (d.posts || [])
    .filter(p => !tag || (p.tags || []).includes(tag))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  if (ps.length === 0) {
    el.innerHTML = "<p>표시할 글이 없다.</p>";
    return;
  }

  el.innerHTML = ps.map(p => {
    const ts = (p.tags || [])
      .map(t => `<a href="./index.html?tag=${encodeURIComponent(t)}">${t}</a>`)
      .join(", ");

    const href = `./posts/${encodeURIComponent(p.slug)}.html`;

    const imageHtml = p.previewImage
      ? `
      <div class="post-item-image-wrapper">
        <a href="${href}">
          <img src="${p.previewImage}" alt="${p.title} Preview" class="post-item-image">
        </a>
      </div>
      `
      : '';

    return `
      <article class="post-item">
        <div class="post-item-content">
          <header class="post-header">
            <h3 class="post-title"><a href="${href}">${p.title}</a></h3>
            <p class="post-meta">
              <time datetime="${p.date}">${p.date_human || p.date}</time> |
              <span class="post-tags">${ts}</span>
            </p>
          </header>
          <div class="post-excerpt">
            <p>${p.excerpt || ""}</p>
          </div>
          <a href="${href}" class="read-more">Read More &rarr;</a>
        </div>
        ${imageHtml}
      </article>
    `;
  }).join("");
})();
