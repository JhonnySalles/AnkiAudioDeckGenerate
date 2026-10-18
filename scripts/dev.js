const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Carregar DEV_PORT do .env se existir, padrão 4600
let devPort = '4600';
const rootDir = path.resolve(__dirname, '..');
const envPath = path.join(rootDir, '.env');

if (fs.existsSync(envPath)) {
  try {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const match = envContent.match(/^\s*DEV_PORT\s*=\s*(\d+)/m);
    if (match && match[1]) {
      devPort = match[1];
    }
  } catch (err) {
    console.warn('[dev-runner] Aviso: Não foi possível ler .env, usando porta padrão:', devPort);
  }
}

process.env.DEV_PORT = devPort;
console.log(`[dev-runner] Iniciando desenvolvimento na porta ${devPort}...`);

const isWindows = process.platform === 'win32';
const npxCmd = isWindows ? 'npx.cmd' : 'npx';

const commands = [
  `ng serve --port ${devPort}`,
  'tsc -p tsconfig.electron.json --watch',
  `wait-on http-get://localhost:${devPort} && electron .`
];

const child = spawn(
  npxCmd,
  ['concurrently', '-k', ...commands.map(cmd => `"${cmd}"`)],
  {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DEV_PORT: devPort }
  }
);

child.on('exit', (code) => {
  process.exit(code || 0);
});
