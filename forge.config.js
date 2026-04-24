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
};