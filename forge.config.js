module.exports = {
  packagerConfig: {
    asar: false,
    files: [
      'dist/**/*',
      'electron/**/*',
      'src/**/*',
      'package.json',
      'node_modules/**/*'
    ]
  },
  rebuildConfig: {
    onlyModules: [],
  },
  makers: [
    {
      name: '@electron-forge/maker-nsis',
      config: {
        installerIcon: 'src/assets/icon.ico',
        uninstallerIcon: 'src/assets/icon.ico',
        installerHeader: 'src/assets/icon.ico',
        installerHeaderIcon: 'src/assets/icon.ico',
      },
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'tendai-mufambisi',
          name: 'STOCKA_POS'
        },
        draft: false,
        prerelease: false
      }
    }
  ],
};