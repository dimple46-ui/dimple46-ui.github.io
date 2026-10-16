import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/candidate-check.yml', import.meta.url), 'utf8');
const repository = 'dimple46-ui/dimple46-ui.github.io';
function job(name) {
  const start = workflow.indexOf(`  ${name}:\n`);
  assert.ok(start >= 0);
  return workflow.slice(start).split(/\n  [a-z][a-z-]+:\n/)[0];
}
function condition(name) {
  const source = job(name).match(/\n    if: ([\s\S]*?)\n    runs-on:/)?.[1];
  assert.ok(source);
  return new vm.Script(`Boolean(${source.replace(/^>-\s*/, '').trim()})`);
}
function context({enabled = 'true', event = 'pull_request', head = 'feature/candidate-access-audit',
  base = 'feature/m2-operational-storage', headRepo = repository, baseRepo = repository,
  ref = 'refs/pull/7/merge'} = {}) {
  return {vars: {CANDIDATE_ACCESS_AUDIT_ENABLED: enabled, CANDIDATE_CHECKS_ENABLED: 'true',
    VALIDATOR_CHECKS_ENABLED: 'true'}, github: {repository, event_name: event, ref, event: {
    pull_request: {head: {ref: head, repo: {full_name: headRepo}},
      base: {ref: base, repo: {full_name: baseRepo}}}}}};
}

test('actual provider gate admits only opted-in dedicated same-repository PR or existing dispatch', () => {
  const gate = condition('provider-access-audit');
  assert.equal(gate.runInNewContext(context()), true);
  assert.equal(gate.runInNewContext(context({event: 'workflow_dispatch',
    ref: 'refs/heads/feature/m2-operational-storage'})), true);
  for (const change of [{enabled: 'false'}, {enabled: ''}, {enabled: 'TRUE'},
    {head: 'feature/research-handoff'}, {base: 'main'}, {headRepo: 'fork/repository'},
    {baseRepo: 'fork/repository'}, {event: 'push'}, {event: 'pull_request_target'},
    {event: 'workflow_dispatch', ref: 'refs/heads/main'}]) {
    assert.equal(gate.runInNewContext(context(change)), false, JSON.stringify(change));
  }
});

test('PR events never activate intelligence or validator jobs even when their opt-ins are true', () => {
  for (const name of ['remote-checks', 'validator-checks']) {
    assert.equal(condition(name).runInNewContext(context()), false, name);
  }
});

test('provider PR checkout pins reviewed audit source and never checks out PR-controlled scripts', () => {
  const audit = job('provider-access-audit');
  assert.match(audit, /github.event_name == 'pull_request' && '6ef8dfcdba2af7148a085c8026100d3ac184b2bf' \|\| github.sha/);
  assert.match(audit, /persist-credentials: false/);
  assert.doesNotMatch(audit, /head\.sha|head\.ref.*ref:|npm |npx |wrangler|curl /);
  assert.match(audit, /run: node scripts\/audit-candidate-access.mjs > candidate-access-audit.json/);
  assert.match(audit, /secrets.CLOUDFLARE_API_TOKEN/);
  assert.match(audit, /vars.CLOUDFLARE_ACCOUNT_ID \|\| secrets.CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(audit, /INTELLIGENCE_READ_TOKEN|VALIDATION_TOKEN|migrations apply/);
  assert.match(audit, /Deployment permission NOT_TESTED/);
});

test('existing workflow gets a narrow PR trigger and persists sanitized audit receipts', () => {
  const trigger = workflow.split('  pull_request:')[1]?.split('  push:')[0];
  assert.match(trigger, /branches: \[feature\/m2-operational-storage\]/);
  assert.match(trigger, /types: \[opened, synchronize, reopened\]/);
  assert.match(trigger, /tests\/candidate-access-workflow.test.mjs/);
  assert.doesNotMatch(workflow, /pull_request_target:|secrets: inherit|contents: write|wrangler deploy/);
  const audit = job('provider-access-audit');
  assert.match(audit, /name: candidate-access-audit-\$\{\{ github.run_id \}\}/);
  assert.match(audit, /retention-days: 7/);
  assert.match(audit, /if-no-files-found: ignore/);
});
