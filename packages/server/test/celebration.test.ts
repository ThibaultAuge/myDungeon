import { describe, expect, it } from 'vitest';
import { celebrationsFor, commandSegments, gitAction, isTestCommand } from '../src/celebration.ts';
import { hookEventSchema, summarize, applyHook, createState } from '../src/reducer.ts';

function post(command: unknown, extra: Record<string, unknown> = {}) {
  return hookEventSchema.parse({
    hook_event_name: 'PostToolUse',
    session_id: 's1',
    cwd: '/x',
    tool_name: 'Bash',
    tool_input: { command },
    ...extra,
  });
}

describe('commandSegments', () => {
  it('splits on shell operators and drops assignments and launchers', () => {
    expect(commandSegments('cd app && CI=1 npx vitest run; git push | cat')).toEqual([
      ['cd', 'app'],
      ['vitest', 'run'],
      ['git', 'push'],
      ['cat'],
    ]);
    expect(commandSegments('pnpm exec jest')).toEqual([['jest']]);
    expect(commandSegments('& git push')).toEqual([['git', 'push']]);
  });
});

describe('gitAction', () => {
  it('finds commit and push after global options', () => {
    expect(gitAction(['git', 'commit', '-m', 'x'])).toBe('commit');
    expect(gitAction(['git', '-C', 'dir', '--no-pager', 'push'])).toBe('push');
    expect(gitAction(['C:\\Program Files\\Git\\bin\\git.exe', 'push'])).toBe('push');
    expect(gitAction(['git', 'commit', '-n', '-m', 'x'])).toBe('commit'); // -n = --no-verify for commit
  });
  it('ignores other subcommands, dry runs and non-git programs', () => {
    expect(gitAction(['git', 'status'])).toBeUndefined();
    expect(gitAction(['git', 'push', '--dry-run'])).toBeUndefined();
    expect(gitAction(['git', 'push', '-n'])).toBeUndefined();
    expect(gitAction(['echo', 'git', 'push'])).toBeUndefined();
    expect(gitAction([])).toBeUndefined();
  });
});

describe('isTestCommand', () => {
  it.each([
    'npm test',
    'npm t',
    'npm run test',
    'npm run test:unit',
    'pnpm test',
    'yarn test:e2e',
    'npx vitest run',
    'jest --ci',
    'npx playwright test',
    'pytest -q',
    'python -m pytest',
    './mvnw -q verify',
    'gradlew.bat check',
    'cargo test',
    'go test ./...',
    'dotnet test',
    'node --test',
    'cd packages/web && npm test 2>&1 | tail -20',
  ])('recognises %s', (cmd) => expect(isTestCommand(cmd)).toBe(true));

  it.each(['npm run build', 'npm install', 'vitest --watch', 'npx vitest watch', 'echo npm test', 'go build', 'playwright install', 'git commit -m "npm test"'])(
    'rejects %s',
    (cmd) => expect(isTestCommand(cmd)).toBe(false),
  );
});

describe('celebrationsFor', () => {
  it('celebrates a successful commit, push or test run', () => {
    expect(celebrationsFor(post('git commit -m "feat: x"'))).toEqual(['commit']);
    expect(celebrationsFor(post('git add -A && git commit -m x && git push'))).toEqual(['push']);
    expect(celebrationsFor(post('npm test', { tool_response: { stdout: 'Tests  12 passed (12)', stderr: '' } }))).toEqual(['tests']);
    expect(celebrationsFor(post('npm test && git push'))).toEqual(['push', 'tests']);
  });

  it('works for PowerShell too', () => {
    const ev = hookEventSchema.parse({ ...post('git push; if ($?) { npm test }'), tool_name: 'PowerShell' });
    expect(celebrationsFor(ev)).toEqual(['push', 'tests']);
  });

  it('does not celebrate failures, other events, tools or odd inputs', () => {
    expect(celebrationsFor(hookEventSchema.parse({ ...post('git push'), hook_event_name: 'PostToolUseFailure' }))).toEqual([]);
    expect(celebrationsFor(hookEventSchema.parse({ ...post('git push'), hook_event_name: 'PreToolUse' }))).toEqual([]);
    expect(celebrationsFor(hookEventSchema.parse({ ...post('git push'), tool_name: 'Read' }))).toEqual([]);
    expect(celebrationsFor(post(42))).toEqual([]);
    expect(celebrationsFor(post(undefined))).toEqual([]);
  });

  it('does not set off fireworks when the output reports failed tests', () => {
    for (const stdout of ['Tests  2 failed | 10 passed', ' FAIL  test/a.test.ts', '3 failing', 'Tests failed.']) {
      expect(celebrationsFor(post('npm test | tail', { tool_response: { stdout } }))).toEqual([]);
    }
    expect(celebrationsFor(post('npm test', { tool_response: 'Tests 0 failed' }))).toEqual(['tests']);
  });

  it('only looks at the start of a huge command', () => {
    expect(celebrationsFor(post(`${'x'.repeat(5000)} && git push`))).toEqual([]);
  });

  it('stays fast on a crafted output', () => {
    const start = performance.now();
    celebrationsFor(post('npm test', { tool_response: { stdout: '1'.repeat(200_000) + ' faile' } }));
    expect(performance.now() - start).toBeLessThan(200);
  });
});

describe('summarize', () => {
  it('adds the celebration kinds, never the command, and nothing when there is none', () => {
    const state = createState();
    const ev = post('git push origin main');
    const s = applyHook(state, ev, 1);
    expect(summarize(ev, s, 1).celebrations).toEqual(['push']);
    const plain = post('ls');
    expect('celebrations' in summarize(plain, applyHook(state, plain, 2), 2)).toBe(false);
  });
});
