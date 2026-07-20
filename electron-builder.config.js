// Define the native binaries that are shared across platforms
const nativeBinaries = [
  'global-key-listener',
  'audio-recorder',
  'text-writer',
  'active-application',
  'selected-text-reader',
]

const customSoundResources = {
  from: 'resources/sounds',
  to: 'sounds',
  filter: ['**/*.wav'],
}

const getMacResources = () =>
  nativeBinaries.map(binary => ({
    from: `native/target/\${arch}-apple-darwin/release/${binary}`,
    to: `binaries/${binary}`,
  }))

const getWindowsResources = () =>
  nativeBinaries.map(binary => ({
    from: `native/target/x86_64-pc-windows-msvc/release/${binary}.exe`,
    to: `binaries/${binary}.exe`,
  }))

const stage = process.env.ITO_ENV || 'prod'
module.exports = {
  appId: stage === 'prod' ? 'ai.ito.ito' : `ai.ito.ito-${stage.toLowerCase()}`,
  productName: stage === 'prod' ? 'Ito' : `Ito-${stage}`,
  copyright: 'Copyright © 2025 Demox Labs',
  directories: {
    buildResources: 'resources',
    output: 'dist',
  },
  files: [
    '!**/.vscode/*',
    '!src/*',
    '!electron.vite.config.{js,ts,mjs,cjs}',
    '!.eslintignore',
    '!.eslintrc.cjs',
    '!.prettierignore',
    '!.prettierrc.yaml',
    '!README.md',
    '!.env',
    '!.env.*',
    '!.npmrc',
    '!pnpm-lock.yaml',
    '!tsconfig.json',
    '!tsconfig.node.json',
    '!tsconfig.web.json',
    '!native/**',
    '!build-*.sh',
    // `files` has no allowlist, so electron-builder's default **/* applies:
    // everything at the repo root ships in app.asar unless negated here.
    '!dist',
    '!dist.*',
    '!.history',
    '!opensrc',
    '!server',
    '!.wayfinder',
    '!tmp',
    '!.github',
    '!.claude',
    '!bun.lock',
    '!out.json',
    {
      from: 'out',
      filter: ['**/*'],
    },
  ],
  asar: true,
  asarUnpack: ['resources/**'],
  extraMetadata: {
    // package.json is the source of truth; VITE_ITO_VERSION can still
    // override for one-off builds.
    version: process.env.VITE_ITO_VERSION || require('./package.json').version,
  },
  // Embeds app-update.yml and generates latest.yml so electron-updater can
  // consume the fork's GitHub Releases. Never auto-published: build-app.sh
  // passes --publish=never; assets are uploaded to the release manually.
  publish: {
    provider: 'github',
    owner: 'calebrussel77',
    repo: 'ito-speech-to-text',
  },
  protocols: {
    name: 'ito',
    schemes: stage === 'prod' ? ['ito'] : [`ito-dev`],
  },
  mac: {
    target: 'default',
    icon: 'resources/build/icon.icns',
    darkModeSupport: true,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    identity: 'Demox Labs, Inc. (294ZSTM7UB)',
    notarize: true,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Ito requires microphone access to transcribe your speech.',
    },
    extraResources: [
      ...getMacResources(),
      customSoundResources,
      { from: 'resources/build/ito-logo.png', to: 'build/ito-logo.png' },
    ],
  },
  dmg: {
    artifactName:
      stage === 'prod'
        ? 'Ito-Installer.${ext}'
        : `Ito-${stage}-Installer.\${ext}`,
  },
  win: {
    target: [
      {
        target: 'zip',
        arch: ['x64'],
      },
      {
        target: 'nsis',
        arch: ['x64'],
      },
    ],
    artifactName: '${productName}-${version}.${ext}',
    icon: 'resources/build/icon.ico',
    executableName: 'Ito',
    requestedExecutionLevel: 'asInvoker',
    extraResources: [
      ...getWindowsResources(),
      customSoundResources,
      { from: 'resources/build/ito-logo.png', to: 'build/ito-logo.png' },
    ],
    forceCodeSigning: false,
    asarUnpack: [
      'resources/**',
      '**/node_modules/@sentry/**',
      '**/node_modules/sqlite3/**',
    ],
  },
  nodeGypRebuild: false,
  buildDependenciesFromSource: false,
  nsis: {
    shortcutName: '${productName}',
    uninstallDisplayName: '${productName}-uninstaller',
    include: 'build/installer.nsh',
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    deleteAppDataOnUninstall: true,
  },
}
