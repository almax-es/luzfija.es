/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://luzfija.es';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&middot;/g, '·')
    .replace(/&rarr;/g, '→');
}

function stripHtml(value) {
  return normalizeWhitespace(decodeHtmlEntities(String(value || '').replace(/<[^>]+>/g, ' ')))
    .replace(/\s+([,.;:!?%)])/g, '$1');
}

function extractParagraphTexts(fragment) {
  return [...String(fragment || '').matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripHtml(match[1] || ''))
    .filter(Boolean);
}

function resolveUrl(rawUrl) {
  return new URL(String(rawUrl || '').trim(), `${BASE_URL}/`).href;
}

function extractJsonLdObjects(html) {
  const objects = [];
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];

  for (const script of scripts) {
    const jsonMatch = script.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    if (!jsonMatch?.[1]) continue;

    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed)) {
        objects.push(...parsed.filter((item) => item && typeof item === 'object'));
      } else if (parsed && typeof parsed === 'object') {
        objects.push(parsed);
      }
    } catch {
      // Invalid JSON-LD is covered elsewhere.
    }
  }

  return objects;
}

function extractNovedadesPageItems(html) {
  return [...String(html || '').matchAll(/<article class="novedad" id="([^"]+)">([\s\S]*?)<\/article>/gi)]
    .map(([, id, body]) => ({
      id,
      fecha: String(body.match(/<time[^>]+datetime="([^"]+)"/i)?.[1] || '').trim(),
      tipo: normalizeWhitespace(body.match(/<span class="novedad-tipo [^"]+">([\s\S]*?)<\/span>/i)?.[1] || '').toLowerCase(),
      titulo: stripHtml(body.match(/<h3>([\s\S]*?)<\/h3>/i)?.[1] || ''),
      texto: extractParagraphTexts(body).join(' '),
      enlace: String(body.match(/<a class="novedad-link" href="([^"]+)"/i)?.[1] || '').trim()
    }))
    .filter((item) => item.id && item.fecha && item.tipo && item.titulo && item.texto);
}

function parseRssPubDateToYmd(rawValue) {
  const match = normalizeWhitespace(rawValue).match(/^[A-Za-z]{3}, (\d{2}) ([A-Za-z]{3}) (\d{4}) /);
  if (!match) return '';

  const months = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12'
  };

  const month = months[match[2]];
  if (!month) return '';
  return `${match[3]}-${month}-${match[1]}`;
}

function extractFeedItems(feedXml) {
  return [...String(feedXml || '').matchAll(/<item>\s*([\s\S]*?)\s*<\/item>/gi)]
    .map(([, block]) => ({
      titulo: stripHtml(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ''),
      link: decodeHtmlEntities(String(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '').trim()),
      guid: decodeHtmlEntities(String(block.match(/<guid\b[^>]*>([\s\S]*?)<\/guid>/i)?.[1] || '').trim()),
      fecha: parseRssPubDateToYmd(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || ''),
      tipo: normalizeWhitespace(block.match(/<category>([\s\S]*?)<\/category>/i)?.[1] || '').toLowerCase(),
      texto: stripHtml(block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '')
    }))
    .filter((item) => item.titulo || item.link || item.guid);
}

const novedadesHtml = fs.readFileSync(path.join(REPO_ROOT, 'novedades.html'), 'utf8');
const novedadesJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'novedades.json'), 'utf8'));
const feedXml = fs.readFileSync(path.join(REPO_ROOT, 'feed.xml'), 'utf8');
const pageItems = extractNovedadesPageItems(novedadesHtml);
const feedItems = extractFeedItems(feedXml);

describe('Novedades content guardrails', () => {
  it('supports novedades articles with multiple paragraphs', () => {
    const html = `
      <article class="novedad" id="multi-paragraph">
        <div class="novedad-header">
          <span class="novedad-tipo regulatorio">Regulatorio</span>
          <time class="novedad-fecha" datetime="2026-04-17">17 de abril de 2026</time>
        </div>
        <h3>Ejemplo</h3>
        <p>Primer bloque.</p>
        <p>Segundo bloque con <strong>detalle</strong>.</p>
      </article>
    `;

    expect(extractNovedadesPageItems(html)).toEqual([
      {
        id: 'multi-paragraph',
        fecha: '2026-04-17',
        tipo: 'regulatorio',
        titulo: 'Ejemplo',
        texto: 'Primer bloque. Segundo bloque con detalle.',
        enlace: ''
      }
    ]);
  });

  it('keeps novedades page and JSON entries aligned', () => {
    expect(novedadesJson).toHaveLength(pageItems.length);

    const errors = [];

    pageItems.forEach((pageItem, index) => {
      const jsonItem = novedadesJson[index];
      const expectedLink = pageItem.enlace || `/novedades.html#${pageItem.id}`;

      if (jsonItem.fecha !== pageItem.fecha) {
        errors.push(`${pageItem.id}: JSON fecha ${jsonItem.fecha} != HTML ${pageItem.fecha}`);
      }
      if (jsonItem.tipo !== pageItem.tipo) {
        errors.push(`${pageItem.id}: JSON tipo ${jsonItem.tipo} != HTML ${pageItem.tipo}`);
      }
      if (jsonItem.titulo !== pageItem.titulo) {
        errors.push(`${pageItem.id}: JSON titulo does not match HTML`);
      }
      if (normalizeWhitespace(jsonItem.texto) !== pageItem.texto) {
        errors.push(`${pageItem.id}: JSON texto does not match HTML`);
      }
      if (resolveUrl(jsonItem.enlace) !== resolveUrl(expectedLink)) {
        errors.push(`${pageItem.id}: JSON enlace ${jsonItem.enlace} != esperado ${expectedLink}`);
      }
    });

    expect(errors).toEqual([]);
  });

  it('keeps RSS feed aligned with novedades page entries', () => {
    expect(feedItems).toHaveLength(pageItems.length);

    const errors = [];

    pageItems.forEach((pageItem, index) => {
      const feedItem = feedItems[index];
      const expectedLink = `${BASE_URL}/novedades.html#${pageItem.id}`;

      if (feedItem.titulo !== pageItem.titulo) {
        errors.push(`${pageItem.id}: RSS title does not match HTML`);
      }
      if (feedItem.fecha !== pageItem.fecha) {
        errors.push(`${pageItem.id}: RSS fecha ${feedItem.fecha} != HTML ${pageItem.fecha}`);
      }
      if (feedItem.tipo !== pageItem.tipo) {
        errors.push(`${pageItem.id}: RSS categoria ${feedItem.tipo} != HTML ${pageItem.tipo}`);
      }
      if (feedItem.texto !== pageItem.texto) {
        errors.push(`${pageItem.id}: RSS description does not match HTML`);
      }
      if (feedItem.link !== expectedLink) {
        errors.push(`${pageItem.id}: RSS link ${feedItem.link} != ${expectedLink}`);
      }
      if (!feedItem.guid) {
        errors.push(`${pageItem.id}: RSS guid vacio`);
      }
    });

    expect(errors).toEqual([]);
  });

  it('keeps novedades ItemList structured data aligned with visible articles', () => {
    const itemList = extractJsonLdObjects(novedadesHtml).find(
      (node) => normalizeWhitespace(node?.['@type'] || '').toLowerCase() === 'itemlist'
    );

    expect(itemList).toBeTruthy();
    expect(itemList.numberOfItems).toBe(pageItems.length);
    expect(Array.isArray(itemList.itemListElement)).toBe(true);
    expect(itemList.itemListElement).toHaveLength(pageItems.length);

    const errors = [];

    pageItems.forEach((pageItem, index) => {
      const structuredItem = itemList.itemListElement[index];
      const expectedUrl = `${BASE_URL}/novedades.html#${pageItem.id}`;

      if (structuredItem.position !== index + 1) {
        errors.push(`${pageItem.id}: ItemList position ${structuredItem.position} != ${index + 1}`);
      }
      if (structuredItem.name !== pageItem.titulo) {
        errors.push(`${pageItem.id}: ItemList name does not match HTML`);
      }
      if (structuredItem.url !== expectedUrl) {
        errors.push(`${pageItem.id}: ItemList url ${structuredItem.url} != ${expectedUrl}`);
      }
    });

    expect(errors).toEqual([]);
  });
});
