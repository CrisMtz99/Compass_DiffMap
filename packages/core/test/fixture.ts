import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const write = (root: string, files: Record<string, string>) => {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
};
const git = (root: string, ...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'ignore' });

/** Repo multi-lenguaje con una rama base (main) y cambios en una rama feature. */
export function makeFixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'compass-fx-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@compass.dev');
  git(root, 'config', 'user.name', 'Compass Test');
  write(root, {
    'src/app/main.ts': `import { ChatService } from '../chat/chat.service';\nimport { formatDate } from '@utils/format';\n\nexport function main() {\n  const s = new ChatService();\n  s.send('hola');\n  console.log(formatDate(new Date()));\n}\n`,
    'src/chat/chat.service.ts': `import { formatDate } from '../utils/format';\n\nexport class ChatService {\n  history: string[] = [];\n\n  send(msg: string) {\n    this.history.push(msg);\n    this.log(msg);\n  }\n\n  log(msg: string) {\n    console.log(formatDate(new Date()), msg);\n  }\n}\n`,
    'src/utils/format.ts': `export function formatDate(d: Date): string {\n  return d.toISOString();\n}\n\nexport const pad = (n: number) => String(n).padStart(2, '0');\n`,
    'src/utils/old.ts': `export function legacy() {\n  return 1;\n}\n`,
    'tsconfig.json': `{\n  // alias\n  "compilerOptions": { "baseUrl": ".", "paths": { "@utils/*": ["src/utils/*"] } },\n}\n`,
    'py/pkg/__init__.py': '',
    'py/pkg/models.py': `class User:\n    def __init__(self, name):\n        self.name = name\n\n    def greet(self):\n        return helper(self.name)\n\n\ndef helper(x):\n    return x.upper()\n`,
    'py/pkg/api.py': `from .models import User\n\n\ndef handle(name):\n    u = User(name)\n    return u.greet()\n`,
    'java/src/main/java/com/acme/Order.java': `package com.acme;\n\npublic class Order {\n    private int total;\n\n    public int getTotal() {\n        return total;\n    }\n}\n`,
    'java/src/main/java/com/acme/Billing.java': `package com.acme;\n\nimport java.util.List;\n\npublic class Billing {\n    public int charge(Order o) {\n        return o.getTotal();\n    }\n}\n`,
    'README.md': '# fixture\n',
  });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'checkout', '-q', '-b', 'feature');
  write(root, {
    'src/chat/chat.service.ts': `import { formatDate, pad } from '../utils/format';\n\nexport class ChatService {\n  history: string[] = [];\n\n  send(msg: string) {\n    this.history.push(msg);\n    this.audit(msg);\n  }\n\n  audit(msg: string) {\n    console.log(formatDate(new Date()), pad(msg.length), msg);\n  }\n}\n`,
    'src/utils/format.ts': `export function formatDate(d: Date): string {\n  return d.toISOString().slice(0, 10);\n}\n\nexport const pad = (n: number) => String(n).padStart(2, '0');\n`,
    'src/chat/history.ts': `import { ChatService } from './chat.service';\n\nexport function lastMessage(s: ChatService) {\n  return s.history[s.history.length - 1];\n}\n`,
    'py/pkg/models.py': `class User:\n    def __init__(self, name):\n        self.name = name\n\n    def greet(self):\n        return helper(self.name) + "!"\n\n\ndef helper(x):\n    return x.upper()\n`,
    'java/src/main/java/com/acme/Billing.java': `package com.acme;\n\nimport java.util.List;\n\npublic class Billing {\n    public int charge(Order o) {\n        return o.getTotal() * 2;\n    }\n\n    public int refund(Order o) {\n        return -o.getTotal();\n    }\n}\n`,
  });
  rmSync(join(root, 'src/utils/old.ts'));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'feature');
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
