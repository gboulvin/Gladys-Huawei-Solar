import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

// Older cores reject a manifest carrying a field they do not know, and the
// store indexer refuses `keywords` / `countries` below this minimum.
const CATALOG_FIELDS_MIN_GLADYS = [5, 3, 0];

const minGladysVersion = () => {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
};

const isAtLeast = (version, minimum) => {
  for (let i = 0; i < minimum.length; i += 1) {
    if (version[i] !== minimum[i]) {
      return version[i] > minimum[i];
    }
  }
  return true;
};

test('catalog keywords are 1-10 unique terms of 2-30 characters', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  for (const keyword of keywords) {
    assert.equal(typeof keyword, 'string');
    assert.ok(keyword.trim().length >= 2 && keyword.trim().length <= 30, keyword);
  }
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(
    new Set(normalized).size,
    keywords.length,
    'keywords must be unique once trimmed and lowercased',
  );
});

test('catalog countries, when declared, are unique ISO 3166-1 alpha-2 codes', () => {
  if (manifest.countries === undefined) {
    return;
  }
  assert.ok(manifest.countries.length >= 1 && manifest.countries.length <= 20);
  for (const country of manifest.countries) {
    assert.match(country, /^[A-Z]{2}$/);
  }
  assert.equal(new Set(manifest.countries).size, manifest.countries.length);
});

test('catalog keywords and countries require Gladys >= 5.3.0', () => {
  assert.ok(isAtLeast(minGladysVersion(), CATALOG_FIELDS_MIN_GLADYS), manifest.gladys_version);
});
