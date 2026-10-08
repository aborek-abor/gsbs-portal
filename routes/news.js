const express = require('express');
const articles = require('../data/news');

const router = express.Router();
const SITE = (process.env.SITE_URL || 'https://ghanaianbiomedicalsociety.org').replace(/\/$/, '');
const SITE_NAME = 'Ghanaian Society for Biomedical Scientists';
const OG_IMAGE = SITE + '/og-default.png';

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sorted = () => articles.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
const fmtDate = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const CSS = `
:root{--paper:#F3F5EF;--ink:#14201C;--ink-soft:#4B5A53;--hairline:#D6D9CD;--green:#0B5D3B;--green-deep:#083F28;--gold:#B8860B;--serif:'Source Serif 4',Georgia,serif;--sans:'Inter',system-ui,sans-serif;--mono:'IBM Plex Mono',monospace}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.5;font-size:15px}
header{background:var(--green-deep);color:#fff;border-bottom:3px solid var(--gold);padding:12px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:12px;color:#fff;text-decoration:none}.brand img{width:36px;height:36px;object-fit:contain}
.brand span{font-family:var(--serif);font-weight:600;font-size:17px}
nav a{color:#d9e4de;text-decoration:none;font-size:13px;margin-left:16px;padding-bottom:4px;border-bottom:2px solid transparent}nav a:hover,nav a.on{color:#fff;border-bottom-color:var(--gold)}
main{max-width:760px;margin:0 auto;padding:36px 20px 60px}
.meta{font-family:var(--mono);font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:var(--green);margin:0 0 10px}
h1{font-family:var(--serif);font-size:34px;line-height:1.15;margin:0 0 14px}h2{font-family:var(--serif);font-size:22px;margin:34px 0 12px}h3{font-family:var(--serif);font-size:21px;line-height:1.25;margin:0 0 8px}
.byline{font-size:13.5px;color:var(--ink-soft);margin:0 0 26px;padding-bottom:18px;border-bottom:1px solid var(--hairline)}
.body p{font-family:var(--serif);font-size:17.5px;line-height:1.7;margin:0 0 18px}
.item{border-top:1px solid var(--hairline);padding:22px 4px}.item:last-child{border-bottom:1px solid var(--hairline)}.item p{color:var(--ink-soft);max-width:640px;margin:0 0 14px}
.item h3 a{color:inherit;text-decoration:none}
.btn{display:inline-block;border:1px solid var(--ink);background:transparent;color:var(--ink);padding:7px 14px;font-size:13px;text-decoration:none;cursor:pointer;font-family:var(--sans)}.btn:hover{background:var(--ink);color:#fff}
.tools{margin-top:34px;padding-top:18px;border-top:1px solid var(--hairline);display:flex;gap:10px;flex-wrap:wrap}
.back{font-size:12.5px;color:var(--ink-soft);text-decoration:none}
footer{text-align:center;font-size:12px;color:var(--ink-soft);padding:24px 20px 40px}
@media(max-width:640px){h1{font-size:27px}.body p{font-size:16.5px}header{padding:10px 16px}nav a{margin:0 12px 0 0}}`;

function layout({ title, description, canonical, ogType, extraHead, active, content }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:site_name" content="${esc(SITE_NAME)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<link rel="icon" href="/gsbs-logo.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>${CSS}</style>
${extraHead || ''}
</head>
<body>
<header>
  <a class="brand" href="/"><img src="/gsbs-logo.png" alt="GSBS logo"><span>${esc(SITE_NAME)}</span></a>
  <nav>
    <a href="/">Home</a><a href="/#about">About</a><a href="/news" class="${active === 'news' ? 'on' : ''}">News</a><a href="/#join">Join</a><a href="/#governance">Governance</a><a href="/#apply">Apply</a><a href="/#login">Member login</a>
  </nav>
</header>
<main>${content}</main>
<footer>&copy; ${new Date().getFullYear()} ${esc(SITE_NAME)}. Registered Company Limited by Guarantee, Ghana. Reg. No. CG0594200926.</footer>
</body>
</html>`;
}

router.get('/api/news', (req, res) => {
  res.json(sorted().map(({ id, category, date, author, title, summary }) => ({ id, category, date, author, title, summary })));
});

router.get('/news', (req, res) => {
  const items = sorted().map((n) => `
    <article class="item">
      <p class="meta">${esc(n.category)} &middot; ${esc(fmtDate(n.date))}</p>
      <h3><a href="/news/${esc(n.id)}">${esc(n.title)}</a></h3>
      <p>${esc(n.summary)}</p>
      <a class="btn" href="/news/${esc(n.id)}">Read article</a>
    </article>`).join('');
  res.type('html').send(layout({
    title: `News | ${SITE_NAME}`,
    description: 'Statements, opinion and updates from the Ghanaian Society for Biomedical Scientists.',
    canonical: SITE + '/news',
    ogType: 'website',
    active: 'news',
    content: `<p class="meta">From the Society</p><h1 style="font-size:28px">News</h1><p style="color:var(--ink-soft);font-size:16.5px;max-width:620px">Statements, opinion and updates from the Ghanaian Society for Biomedical Scientists.</p><div style="margin-top:26px">${items}</div>`
  }));
});

router.get('/news/:slug', (req, res) => {
  const n = articles.find((a) => a.id === req.params.slug);
  if (!n) {
    return res.status(404).type('html').send(layout({
      title: `Article not found | ${SITE_NAME}`, description: 'This article could not be found.',
      canonical: SITE + '/news', ogType: 'website', active: 'news',
      content: '<h1>Article not found</h1><p><a class="back" href="/news">&larr; Back to News</a></p>'
    }));
  }
  const url = `${SITE}/news/${n.id}`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: n.title,
    description: n.summary,
    datePublished: n.date,
    dateModified: n.date,
    mainEntityOfPage: url,
    image: [OG_IMAGE],
    author: { '@type': 'Person', name: n.author, jobTitle: n.role },
    publisher: { '@type': 'Organization', name: SITE_NAME, logo: { '@type': 'ImageObject', url: SITE + '/gsbs-logo.png' } }
  };
  const extraHead = `<meta property="article:published_time" content="${n.date}">
<meta property="article:author" content="${esc(n.author)}">
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
  const content = `
  <a class="back" href="/news">&larr; Back to News</a>
  <article style="margin-top:18px">
    <p class="meta">${esc(n.category)} &middot; ${esc(fmtDate(n.date))}</p>
    <h1>${esc(n.title)}</h1>
    <p class="byline">By <strong>${esc(n.author)}</strong>, ${esc(n.role)}</p>
    <div class="body">${n.body}</div>
    <div class="tools">
      <button class="btn" id="copyLink" type="button">Copy link</button>
      <a class="btn" href="/news">More news</a>
    </div>
  </article>
  <script>
  document.getElementById('copyLink').addEventListener('click',function(){var b=this,u=location.href;function d(){var t=b.textContent;b.textContent='Link copied';setTimeout(function(){b.textContent=t},1800)}
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u).then(d,function(){prompt('Copy this link',u)})}else{prompt('Copy this link',u)}});
  </script>`;
  res.type('html').send(layout({ title: `${n.title} | ${SITE_NAME}`, description: n.summary, canonical: url, ogType: 'article', extraHead, active: 'news', content }));
});

router.get('/sitemap.xml', (req, res) => {
  const urls = [
    { loc: SITE + '/', lastmod: null },
    { loc: SITE + '/news', lastmod: sorted()[0] ? sorted()[0].date : null },
    ...sorted().map((n) => ({ loc: `${SITE}/news/${n.id}`, lastmod: n.date }))
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n') + '\n</urlset>\n';
  res.type('application/xml').send(xml);
});

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /uploads/\n\nSitemap: ${SITE}/sitemap.xml\n`);
});

module.exports = router;
