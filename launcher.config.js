const os = require('os');
const path = require('path');

module.exports = {
  // Root directory to scan for projects (change this path if needed)
  devRoot: path.join(os.homedir(), 'dev'),

  // Maximum scan depth (1 = direct children, 2 = one sub-folder, etc.)
  // dev/RAC/IsiracNetApi/isirac-gate = 3 levels → scanDepth 5 for broad coverage
  scanDepth: 5,

  // Web launcher port (overridable via the PORT env variable)
  port: Number(process.env.PORT) || 4242,

  // Config file name within each project
  configFile: '.launcher.yml',

  // Directories to ignore during scan
  ignoreDirs: ['node_modules', '.git', 'dist', 'build', 'bin', 'obj', '.next', '__pycache__', 'venv', '.venv'],
};
