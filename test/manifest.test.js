// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { SCENE_TRIGGER_KEYS, BATTERY_LEVELS } from '../src/triggers.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { INVERTER_STATUS, SELECTABLE_BATTERY_MODES } from '../src/huawei/status.js';
import { EXPORT_LIMIT_MODE } from '../src/huawei/local.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// The languages of the Gladys UI: every user-facing text carries all four.
const LANGUAGES = ['de', 'en', 'es', 'fr'];

const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const REGISTERED_ACTIONS = ['test_connection'];
const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const optionsOf = (list, key, fieldKey) =>
  manifest[list]
    .find((entry) => entry.key === key)
    .fields.find((field) => field.key === fieldKey)
    .options.map((option) => option.value);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

// Every multi-language object of the manifest, with its path.
function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [index, item] of node.entries()) yield* texts(item, `${path}[${index}]`);
  } else if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) yield* texts(value, `${path}.${key}`);
  }
}

test('every user-facing text is in English, French, German and Spanish', () => {
  let count = 0;
  for (const [path, text] of texts(manifest)) {
    count += 1;
    assert.deepEqual(Object.keys(text).sort(), LANGUAGES, path);
    for (const lang of LANGUAGES) assert.ok(text[lang].length > 0, `${path}.${lang}`);
  }
  assert.ok(count > 50);
});

test('the integration declares both the local and the cloud transports', () => {
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.deepEqual(manifest.categories, ['energy']);
});

test('every manifest action has a registered handler', () => {
  assert.deepEqual(keysOf(manifest.actions), REGISTERED_ACTIONS);
});

test('the capability fields require Gladys >= 5.1.0', () => {
  for (const field of ['scene_triggers', 'scene_actions', 'widgets']) {
    assert.ok(manifest[field]?.length > 0, `${field} is declared`);
  }
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]));
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
  for (const widget of manifest.widgets) {
    for (const [lang, label] of Object.entries(widget.label)) {
      assert.ok(label.length >= 3 && label.length <= 30, `widget ${widget.key} label.${lang}`);
    }
    for (const [lang, text] of Object.entries(widget.description)) {
      assert.ok(text.length <= 100, `widget ${widget.key} description.${lang}`);
    }
  }
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...SCENE_TRIGGER_KEYS].sort());
});

test('the filter options match the vocabularies of the code', () => {
  assert.deepEqual(
    optionsOf('scene_triggers', 'inverter_status_changed', 'status').sort(),
    Object.values(INVERTER_STATUS).sort(),
  );
  assert.deepEqual(
    optionsOf('scene_triggers', 'battery_level_crossed', 'level'),
    BATTERY_LEVELS.map(String),
  );
  assert.deepEqual(
    optionsOf('scene_actions', 'set_battery_working_mode', 'mode'),
    SELECTABLE_BATTERY_MODES,
  );
  assert.deepEqual(
    optionsOf('scene_actions', 'set_grid_export_limit', 'mode').sort(),
    Object.values(EXPORT_LIMIT_MODE).sort(),
  );
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type !== 'section') {
      assert.ok(field.key in DEFAULT_CONFIG, `DEFAULT_CONFIG.${field.key} exists`);
    }
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const lang of LANGUAGES) assert.ok(section.description[lang].length <= 1000);
    for (const link of section.links ?? []) assert.match(link.url, /^https:\/\//);
  }
});

test('the secret is never given a default', () => {
  const secrets = manifest.config_schema.filter((f) => f.type === 'secret');
  assert.deepEqual(keysOf(secrets), ['fusionsolar_password']);
  for (const field of secrets) assert.equal(field.default, undefined);
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
  assert.ok(manifest.docker_image.startsWith('ghcr.io/gboulvin/gladys-huawei-solar:'));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('field placeholders are multi-language objects', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', field.key);
  }
});

test('the user documentation exists in the four languages', async () => {
  for (const lang of LANGUAGES) {
    const { size } = await stat(new URL(`../docs/${lang}.md`, import.meta.url));
    assert.ok(size >= 300, `docs/${lang}.md is too short`);
  }
});
