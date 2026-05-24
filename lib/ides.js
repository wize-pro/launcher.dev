const os = require('os');
const path = require('path');
const fs = require('fs');

const HOME     = os.homedir();
const PLATFORM = process.platform;
const PFILES   = process.env['ProgramFiles'] || 'C:\\Program Files';
const PFILES86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCALAPP = process.env['LOCALAPPDATA'] || path.join(HOME, 'AppData', 'Local');

const IDE_CANDIDATES = {
  vscode: {
    darwin: ['/usr/local/bin/code', `${HOME}/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code`, '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'],
    win32:  [`${LOCALAPP}\\Programs\\Microsoft VS Code\\bin\\code.cmd`, `${PFILES}\\Microsoft VS Code\\bin\\code.cmd`],
    linux:  ['/usr/bin/code', '/usr/local/bin/code', `${HOME}/.local/bin/code`],
  },
  cursor: {
    darwin: ['/usr/local/bin/cursor', `${HOME}/Applications/Cursor.app/Contents/MacOS/cursor`, '/Applications/Cursor.app/Contents/MacOS/cursor'],
    win32:  [`${LOCALAPP}\\Programs\\cursor\\Cursor.exe`],
    linux:  ['/usr/bin/cursor', '/usr/local/bin/cursor', `${HOME}/.local/bin/cursor`],
  },
  windsurf: {
    darwin: ['/usr/local/bin/windsurf', `${HOME}/Applications/Windsurf.app/Contents/MacOS/windsurf`, '/Applications/Windsurf.app/Contents/MacOS/windsurf'],
    win32:  [`${LOCALAPP}\\Programs\\windsurf\\Windsurf.exe`],
    linux:  ['/usr/bin/windsurf', '/usr/local/bin/windsurf', `${HOME}/.local/bin/windsurf`],
  },
  rider: {
    darwin: ['/usr/local/bin/rider', `${HOME}/Applications/Rider.app/Contents/MacOS/rider`, '/Applications/Rider.app/Contents/MacOS/rider'],
    win32:  [`${PFILES}\\JetBrains\\Rider\\bin\\rider64.exe`, `${PFILES86}\\JetBrains\\Rider\\bin\\rider64.exe`],
    linux:  ['/usr/local/bin/rider', `${HOME}/.local/share/JetBrains/Toolbox/scripts/rider`],
  },
  webstorm: {
    darwin: ['/usr/local/bin/webstorm', `${HOME}/Applications/WebStorm.app/Contents/MacOS/webstorm`, '/Applications/WebStorm.app/Contents/MacOS/webstorm'],
    win32:  [`${PFILES}\\JetBrains\\WebStorm\\bin\\webstorm64.exe`, `${PFILES86}\\JetBrains\\WebStorm\\bin\\webstorm64.exe`],
    linux:  ['/usr/local/bin/webstorm', `${HOME}/.local/share/JetBrains/Toolbox/scripts/webstorm`],
  },
  idea: {
    darwin: ['/usr/local/bin/idea', `${HOME}/Applications/IntelliJ IDEA.app/Contents/MacOS/idea`, '/Applications/IntelliJ IDEA.app/Contents/MacOS/idea'],
    win32:  [`${PFILES}\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe`, `${PFILES86}\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe`],
    linux:  ['/usr/local/bin/idea', `${HOME}/.local/share/JetBrains/Toolbox/scripts/idea`],
  },
  pycharm: {
    darwin: ['/usr/local/bin/pycharm', `${HOME}/Applications/PyCharm.app/Contents/MacOS/pycharm`, '/Applications/PyCharm.app/Contents/MacOS/pycharm'],
    win32:  [`${PFILES}\\JetBrains\\PyCharm\\bin\\pycharm64.exe`, `${PFILES86}\\JetBrains\\PyCharm\\bin\\pycharm64.exe`],
    linux:  ['/usr/local/bin/pycharm', `${HOME}/.local/share/JetBrains/Toolbox/scripts/pycharm`],
  },
  zed: {
    darwin: ['/usr/local/bin/zed', `${HOME}/Applications/Zed.app/Contents/MacOS/zed`, '/Applications/Zed.app/Contents/MacOS/zed'],
    win32:  [`${LOCALAPP}\\Zed\\zed.exe`],
    linux:  ['/usr/bin/zed', '/usr/local/bin/zed', `${HOME}/.local/bin/zed`],
  },
  sublime: {
    darwin: ['/usr/local/bin/subl', '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl'],
    win32:  [`${PFILES}\\Sublime Text\\subl.exe`, `${PFILES86}\\Sublime Text\\subl.exe`],
    linux:  ['/usr/bin/subl', '/usr/local/bin/subl'],
  },
};

function resolveIdeExec(ide) {
  const platformCandidates = (IDE_CANDIDATES[ide.id] || {})[PLATFORM] || [];
  return platformCandidates.find(p => fs.existsSync(p)) || ide.cmd;
}

module.exports = { IDE_CANDIDATES, resolveIdeExec };
