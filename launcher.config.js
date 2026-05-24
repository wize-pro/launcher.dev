const os = require('os');
const path = require('path');

module.exports = {
  // Racine où scanner les projets (modifie ce chemin si besoin)
  devRoot: path.join(os.homedir(), 'dev'),

  // Profondeur max de scan (1 = direct, 2 = un sous-dossier, etc.)
  // dev/RAC/IsiracNetApi/isirac-gate = 3 niveaux → scanDepth 5 pour couvrir large
  scanDepth: 5,

  // Port du launcher web (surchargeable via la variable d'env PORT)
  port: Number(process.env.PORT) || 4242,

  // Nom du fichier de config dans chaque projet
  configFile: '.launcher.yml',

  // Dossiers à ignorer lors du scan
  ignoreDirs: ['node_modules', '.git', 'dist', 'build', 'bin', 'obj', '.next', '__pycache__', 'venv', '.venv'],
};
