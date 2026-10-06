import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');

test('repair-site inquiry form uses the REG.RU receiver, never Vercel', () => {
  const site = read('chinilkin/index.html');
  assert.match(site, /https:\/\/remontcompsbp\.ru\/api\/website-leads/);
  assert.doesNotMatch(site, /vercel\.app\/api\/leads|location\.href/);
  assert.match(site, /payload\.page = location\.pathname/);
  assert.match(site, /quickForm\.consent\.checked/);
  assert.match(site, /name="website" tabindex="-1"/);
  assert.match(site, /website:quickForm\.website\.value/);
});

test('website leads are validated, rate-limited and stored outside the public folder', () => {
  const gateway = read('b2bhelp-gateway/regru/api/index.php');
  assert.match(gateway, /'\/website-leads'/);
  assert.match(gateway, /accept_website_lead\(/);
  assert.match(gateway, /list_website_leads\(/);
  assert.match(gateway, /update_website_lead\(/);
  assert.match(gateway, /'\/website-leads'\s*=>\s*\['GET', 'POST'\]/);
  assert.match(gateway, /!in_array\(\$method, \$allowedMethods, true\)/);
  assert.match(gateway, /hash_hmac\('sha256'/);
  assert.match(gateway, /count\(\$times\) >= 5/);
  assert.match(gateway, /chmod\(\$path, 0600\)/);
  assert.match(gateway, /dirname\(\$configPath\)/);
  assert.match(gateway, /!in_array\(\$origin, allowed_origins\(\), true\)/);
  assert.match(gateway, /\['owner', 'dispatcher_logistic'\]/);
});

test('owner/logistics CRM exposes a manual website inbox and order conversion', () => {
  const inbox = read('website-leads-inbox.js');
  assert.match(inbox, /https:\/\/remontcompsbp\.ru\/api/);
  assert.match(inbox, /\['owner', 'dispatcher_logistic'\]/);
  assert.match(inbox, /cache: 'no-store'/);
  assert.doesNotMatch(inbox, /setInterval|setTimeout/);
  assert.match(inbox, /MASTER_AI_OPEN_ORDER_FROM_WEBSITE/);
  assert.match(read('sw.js'), /website-leads-inbox\.js\?v=1/);
  for (const file of ['index.html', 'dispatcher-logistic.html']) {
    const page = read(file);
    assert.match(page, /website-leads-inbox\.js/);
    assert.match(page, /MASTER_AI_OPEN_ORDER_FROM_WEBSITE/);
    assert.match(page, /MasterAIWebsiteLeads\?\.markOrder/);
  }
});
