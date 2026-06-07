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
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: 'tendai-mufambski',
          name: 'STOCKA_POS'
        },
        draft: false,
        prerelease: false
      }
    }
  ],
};