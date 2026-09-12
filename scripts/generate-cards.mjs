#!/usr/bin/env node
/**
 * Generates the README cards as SVG files in output/.
 * Runs in GitHub Actions with the built-in GITHUB_TOKEN, so the README never
 * depends on a third-party rendering service that can go down.
 *
 * Usage: node scripts/generate-cards.mjs            (needs GITHUB_TOKEN, optional GH_USER)
 *        node scripts/generate-cards.mjs --mock     (renders sample data, no network)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'output');
const USER = process.env.GH_USER || 'harshitsaini01';
const MOCK = process.argv.includes('--mock');

const THEMES = {
  light: {
    suffix: '',
    bg: '#f8f9fa',
    border: '#e3e6ea',
    title: '#667eea',
    text: '#333333',
    muted: '#6b7280',
    accent: '#764ba2',
    grid: '#e3e6ea',
  },
  dark: {
    suffix: '-dark',
    bg: '#0d1117',
    border: '#27303d',
    title: '#8ea2ff',
    text: '#c9d1d9',
    muted: '#8b949e',
    accent: '#b08cff',
    grid: '#21262d',
  },
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);

async function graphql(query, variables = {}) {
  // PROFILE_TOKEN (a classic PAT) wins if set; otherwise the Actions GITHUB_TOKEN is enough.
  const token = process.env.PROFILE_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('No token: set PROFILE_TOKEN or GITHUB_TOKEN');
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: 'bearer ' + token,
      'Content-Type': 'application/json',
      'User-Agent': 'profile-card-generator',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error('GitHub API ' + res.status + ': ' + (await res.text()));
  const body = await res.json();
  if (body.errors) throw new Error('GraphQL: ' + body.errors.map((e) => e.message).join('; '));
  return body.data;
}

const PROFILE_QUERY = `
query($login: String!, $after: String) {
  user(login: $login) {
    name
    login
    contributionsCollection {
      contributionCalendar {
        weeks { contributionDays { date contributionCount } }
      }
    }
    repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        languages(first: 12, orderBy: {field: SIZE, direction: DESC}) {
          edges { size node { name color } }
        }
      }
    }
  }
}`;

async function fetchProfile() {
  let after = null;
  let user = null;
  const repos = [];
  do {
    const data = await graphql(PROFILE_QUERY, { login: USER, after });
    user = data.user;
    repos.push(...user.repositories.nodes);
    after = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
  } while (after);

  const langTotals = new Map();
  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      const entry = langTotals.get(edge.node.name) || { size: 0, color: edge.node.color || '#8b949e' };
      entry.size += edge.size;
      langTotals.set(edge.node.name, entry);
    }
  }
  const languages = [...langTotals.entries()]
    .map(([name, v]) => ({ name, size: v.size, color: v.color }))
    .sort((a, b) => b.size - a.size);

  const days = user.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);

  return { name: user.name || user.login, login: user.login, languages, days };
}

function mockProfile() {
  const days = Array.from({ length: 371 }, (_, i) => ({
    date: new Date(Date.now() - (370 - i) * 86400000).toISOString().slice(0, 10),
    contributionCount: Math.max(0, Math.round(8 + 7 * Math.sin(i / 9) + (i % 11))),
  }));
  return {
    name: 'Harshit Saini',
    login: USER,
    languages: [
      { name: 'TypeScript', size: 520000, color: '#3178c6' },
      { name: 'JavaScript', size: 410000, color: '#f1e05a' },
      { name: 'CSS', size: 120000, color: '#563d7c' },
      { name: 'HTML', size: 90000, color: '#e34c26' },
      { name: 'Python', size: 40000, color: '#3572A5' },
      { name: 'Dockerfile', size: 8000, color: '#384d54' },
    ],
    days,
  };
}

/* ---------------------------------------------------------------- rendering */

const FONT = "'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif";

function frame({ width, height, theme, title, body }) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(title)}">
  <style>
    .card-title { font: 600 17px ${FONT}; fill: ${theme.title}; }
    .label { font: 400 13px ${FONT}; fill: ${theme.text}; }
    .value { font: 600 13px ${FONT}; fill: ${theme.accent}; }
    .muted { font: 400 11px ${FONT}; fill: ${theme.muted}; }
  </style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${theme.bg}" stroke="${theme.border}" />
  <text x="24" y="34" class="card-title">${esc(title)}</text>
${body}
</svg>
`;
}

function langCard(p, theme) {
  const width = 340;
  const height = 200;
  const top = p.languages.slice(0, 6);
  const total = top.reduce((s, l) => s + l.size, 0) || 1;

  const barX = 24;
  const barY = 52;
  const barW = width - 48;
  let cursor = barX;
  const bar = top
    .map((l, i) => {
      const w = Math.max(3, (l.size / total) * barW);
      const x = cursor;
      cursor += w;
      const rx = i === 0 || i === top.length - 1 ? 5 : 0;
      return `  <rect x="${x.toFixed(1)}" y="${barY}" width="${w.toFixed(1)}" height="11" rx="${rx}" fill="${l.color}" />`;
    })
    .join('\n');

  const legend = top
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 24 + col * 150;
      const y = 92 + row * 26;
      const pct = ((l.size / total) * 100).toFixed(1);
      return `  <circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${l.color}" />
  <text x="${x + 18}" y="${y}" class="label">${esc(l.name)}</text>
  <text x="${x + 138}" y="${y}" class="value" text-anchor="end">${pct}%</text>`;
    })
    .join('\n');

  const stamp = `  <text x="24" y="${height - 16}" class="muted">By bytes of code across public repositories</text>`;

  return frame({
    width,
    height,
    theme,
    title: 'Most Used Languages',
    body: bar + '\n' + legend + '\n' + stamp,
  });
}

function activityCard(p, theme) {
  const width = 820;
  const height = 240;
  const left = 46;
  const right = width - 24;
  const topY = 60;
  const bottomY = height - 42;

  // Aggregate contribution days into weeks so the line stays readable.
  const weeks = [];
  for (let i = 0; i < p.days.length; i += 7) {
    const slice = p.days.slice(i, i + 7);
    if (!slice.length) continue;
    weeks.push({ date: slice[0].date, count: slice.reduce((s, d) => s + d.contributionCount, 0) });
  }
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const stepX = (right - left) / Math.max(1, weeks.length - 1);
  const x = (i) => left + i * stepX;
  const y = (v) => bottomY - (v / max) * (bottomY - topY);

  const points = weeks.map((w, i) => x(i).toFixed(1) + ',' + y(w.count).toFixed(1));
  const area = `  <polygon points="${left},${bottomY} ${points.join(' ')} ${right},${bottomY}" fill="${theme.title}" fill-opacity="0.16" />`;
  const line = `  <polyline points="${points.join(' ')}" fill="none" stroke="${theme.accent}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />`;

  const gridLines = [0, 0.5, 1]
    .map((f) => {
      const gy = bottomY - f * (bottomY - topY);
      return `  <line x1="${left}" y1="${gy.toFixed(1)}" x2="${right}" y2="${gy.toFixed(1)}" stroke="${theme.grid}" stroke-width="1" />
  <text x="${left - 8}" y="${(gy + 4).toFixed(1)}" class="muted" text-anchor="end">${Math.round(max * f)}</text>`;
    })
    .join('\n');

  const seenMonths = new Set();
  const monthTicks = weeks
    .map((w, i) => {
      const d = new Date(w.date);
      const key = d.getUTCFullYear() + '-' + d.getUTCMonth();
      if (seenMonths.has(key)) return null;
      seenMonths.add(key);
      const label = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
      return `  <text x="${x(i).toFixed(1)}" y="${bottomY + 18}" class="muted" text-anchor="middle">${label}</text>`;
    })
    .filter(Boolean)
    .join('\n');

  const peakIdx = weeks.reduce((best, w, i) => (w.count > weeks[best].count ? i : best), 0);
  const peak = `  <circle cx="${x(peakIdx).toFixed(1)}" cy="${y(weeks[peakIdx].count).toFixed(1)}" r="4" fill="${theme.accent}" />`;

  const stamp = `  <text x="${right}" y="34" class="muted" text-anchor="end">Weekly contributions over the last 12 months</text>`;

  return frame({
    width,
    height,
    theme,
    title: 'Contribution Activity',
    body: gridLines + '\n' + area + '\n' + line + '\n' + peak + '\n' + monthTicks + '\n' + stamp,
  });
}

/* -------------------------------------------------------------------- main */

const profile = MOCK ? mockProfile() : await fetchProfile();

await mkdir(OUT_DIR, { recursive: true });
const written = [];
for (const theme of Object.values(THEMES)) {
  const files = [
    ['top-langs' + theme.suffix + '.svg', langCard(profile, theme)],
    ['activity-graph' + theme.suffix + '.svg', activityCard(profile, theme)],
  ];
  for (const [name, svg] of files) {
    await writeFile(resolve(OUT_DIR, name), svg, 'utf8');
    written.push(name);
  }
}

console.log('Generated ' + written.length + ' cards for ' + profile.login + ':');
for (const name of written) console.log('  output/' + name);
