import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true, linkify: true });

const root = process.cwd();

const cDir = path.join(root, "content");
const pDir = path.join(cDir, "posts");
const inPosts = (await fs.pathExists(pDir)) ? pDir : cDir;
console.log("[build] inPosts =", inPosts);

const outRoot = root;
const outHtml = path.join(outRoot, "posts");
const outAst = path.join(outRoot, "assets");

// 너 폴더에 post.html이 루트에 있으니 그걸 템플릿으로 씀
const tplPath = path.join(outRoot, "post.html");

const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const toSlug = (s) => String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/(^-|-$)/g, "");

const fmt = (d) => {
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return d;
    const m = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][x.getUTCMonth()];
    return `${m} ${x.getUTCDate()}, ${x.getUTCFullYear()}`;
};

await fs.ensureDir(outHtml);
await fs.ensureDir(outAst);

if (!(await fs.pathExists(tplPath))) {
    throw new Error(`Template not found: ${tplPath}`);
}

const tpl = await fs.readFile(tplPath, "utf8");

const files = (await fs.readdir(inPosts, { withFileTypes: true }))
    .filter(x => x.isFile() && x.name.toLowerCase().endsWith(".md"))
    .map(x => x.name);

const posts = [];

for (const fn of files) {
    const srcMd = path.join(inPosts, fn);
    const base = fn.replace(/\.md$/i, "");

    const raw = await fs.readFile(srcMd, "utf8");
    const x = matter(raw);

    const title = x.data.title ?? base;
    const date = x.data.date ?? "";
    const tags = Array.isArray(x.data.tags) ? x.data.tags : [];
    const excerpt = x.data.excerpt ?? "";

    const slug = toSlug(x.data.slug ?? base);

    const srcAstDir = path.join(inPosts, base);
    const dstAstDir = path.join(outAst, slug);

    // 생성되는 글 HTML은 BLOG/posts/<slug>.html 이므로
    // 에셋은 ../assets/<slug>/... 로 접근하는 게 안전하다
    const astRel = `../assets/${encodeURIComponent(slug)}`;

    let bodyMd = String(x.content || "");

    // 네가 원하는 방식: ![](./post01/img.png) 를 자동 치환
    bodyMd = bodyMd.replaceAll(`](./${base}/`, `](${astRel}/`);
    bodyMd = bodyMd.replaceAll(`(./${base}/`, `(${astRel}/`);

    // {{asset}} 방식도 지원
    bodyMd = bodyMd.replaceAll("{{asset}}", astRel);

    const content = md.render(bodyMd);

    // Extract all image URLs to find a suitable preview
    const imageRegex = /<img src="([^"]+)"/g;
    const allImages = [...content.matchAll(imageRegex)].map(match => match[1]);

    let previewImage = null;
    if (allImages.length > 0) {
        // Prefer the second image if it exists, otherwise fall back to the first.
        const imageUrl = allImages.length >= 2 ? allImages[1] : allImages[0];

        // The path in content is like ../assets/slug/image.png
        // For index.html, we need ./assets/slug/image.png
        previewImage = imageUrl.replace(/^\.\.\//, './');
    }

    const tagsHtml = tags
        .map(t => `<a href="../index.html?tag=${encodeURIComponent(t)}">${esc(t)}</a>`)
        .join(", ");

    const html = tpl
        .replaceAll("{{title}}", esc(title))
        .replaceAll("{{date}}", esc(date))
        .replaceAll("{{date_human}}", esc(fmt(date)))
        .replaceAll("{{tags_html}}", tagsHtml)
        .replaceAll("{{content}}", content);

    await fs.writeFile(path.join(outHtml, `${slug}.html`), html, "utf8");

    // 이미지 폴더(content/posts/post01/)가 있으면 assets/<slug>/로 복사한다
    if (await fs.pathExists(srcAstDir)) {
        await fs.ensureDir(dstAstDir);
        const xs = await fs.readdir(srcAstDir, { withFileTypes: true });
        for (const f of xs) {
            if (!f.isFile()) continue;
            await fs.copy(path.join(srcAstDir, f.name), path.join(dstAstDir, f.name), { overwrite: true });
        }
    }

    posts.push({ title, date, date_human: fmt(date), tags, excerpt, slug, previewImage });
}

posts.sort((a, b) => (a.date < b.date ? 1 : -1));
await fs.writeJson(path.join(outRoot, "posts.json"), { posts }, { spaces: 2 });
