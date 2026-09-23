import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const patterns = [
  {
    name: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  },
  {
    name: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/gu,
  },
  {
    name: 'aws-access-key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/gu,
  },
  {
    name: 'openai-key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    name: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/gu,
  },
];

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'])
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
const findings = [];

for (const file of files) {
  const content = readFileSync(file);
  if (content.includes(0) || content.byteLength > 2_000_000) continue;
  const text = content.toString('utf8');
  for (const { name, pattern } of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split('\n').length;
      const sourceLine = text.split('\n')[line - 1] ?? '';
      if (sourceLine.includes('secret-scan: allow')) continue;
      findings.push({ file, line, type: name });
    }
  }
}

if (findings.length > 0) {
  console.error('Potential committed secrets detected:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.type})`);
  }
  process.exit(1);
}

console.log(`Secret scan passed for ${files.length} tracked and unignored files.`);
