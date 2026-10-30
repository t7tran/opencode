{
  lib,
  stdenvNoCC,
  callPackage,
  bun,
  nodejs,
  sysctl,
  makeBinaryWrapper,
  models-dev,
  ripgrep,
  wayland,
  installShellFiles,
  versionCheckHook,
  writableTmpDirAsHomeHook,
  node_modules ? callPackage ./node_modules.nix { },
}:
stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "opencode";
  inherit (node_modules) version src;
  inherit node_modules;

  nativeBuildInputs = [
    bun
    nodejs # for patchShebangs node_modules
    installShellFiles
    makeBinaryWrapper
    models-dev
    writableTmpDirAsHomeHook
  ];

  postPatch = ''
    # NOTE: Relax Bun version check to be a warning instead of an error
    substituteInPlace packages/script/src/index.ts \
      --replace-fail 'throw new Error(`This script requires bun@''${expectedBunVersionRange}' \
                     'console.warn(`Warning: This script requires bun@''${expectedBunVersionRange}'
  '';

  configurePhase = ''
    runHook preConfigure

    cp -R ${finalAttrs.node_modules}/. .
    patchShebangs node_modules
    patchShebangs packages/*/node_modules

    runHook postConfigure
  '';

  env.MODELS_DEV_API_JSON = "${models-dev}/dist/_api.json";
  env.OPENCODE_DISABLE_MODELS_FETCH = true;
  env.OPENCODE_VERSION = finalAttrs.version;
  env.OPENCODE_CHANNEL = "prod";
  env.NODE_OPTIONS = "--max-old-space-size=4096";

  buildPhase = ''
    runHook preBuild

    cd ./packages/cli
    bun --bun ./script/build.ts --single --skip-install

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    # fork_change start - renamed binary. The marker spans the wrapProgram block
    # because its first line changed and a comment cannot sit between a line
    # continuation and the line it continues.
    install -Dm755 dist/cli-*/bin/genixcode-cli $out/bin/genixcode-cli

    # OpenTUI dlopens Wayland for clipboard images.
    wrapProgram $out/bin/genixcode-cli \
      --prefix PATH : ${
        lib.makeBinPath (
          [
            ripgrep
          ]
          # bun runs sysctl to detect if running on rosetta2
          ++ lib.optional stdenvNoCC.hostPlatform.isDarwin sysctl
        )
      } ${lib.optionalString stdenvNoCC.hostPlatform.isLinux ''
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath [ wayland ]}
      ''}
    # fork_change end

    ln -s genixcode-cli $out/bin/genixcode-cli2 # fork_change - renamed binary

    runHook postInstall
  '';

  postInstall = lib.optionalString (stdenvNoCC.buildPlatform.canExecute stdenvNoCC.hostPlatform) ''
    # v2 dropped the `completion` subcommand; --completions is the global flag.
    # --completions also accepts sh, which emits the same script as bash.
    # staged to files, substitute below rejects anything that is not a regular file
    # fork_change start - renamed binary
    $out/bin/genixcode-cli --completions bash > genixcode-cli.bash
    $out/bin/genixcode-cli --completions zsh > _genixcode-cli
    $out/bin/genixcode-cli --completions fish > genixcode-cli.fish

    installShellCompletion --cmd genixcode-cli \
      --bash genixcode-cli.bash \
      --fish genixcode-cli.fish \
      --zsh _genixcode-cli

    # OPENCODE_CLI_NAME is a build-time define, so the genixcode-cli2 copies are
    # renamed rather than regenerated. --replace-fail is a global literal
    # substitution, so any lowercase genixcode-cli that later appears in a
    # description or help text ships as genixcode-cli2 in the genixcode-cli2 copy.
    substitute genixcode-cli.bash genixcode-cli2.bash --replace-fail genixcode-cli genixcode-cli2
    substitute _genixcode-cli _genixcode-cli2 --replace-fail genixcode-cli genixcode-cli2
    substitute genixcode-cli.fish genixcode-cli2.fish --replace-fail genixcode-cli genixcode-cli2

    installShellCompletion --cmd genixcode-cli2 \
      --bash genixcode-cli2.bash \
      --fish genixcode-cli2.fish \
      --zsh _genixcode-cli2
    # fork_change end
  '';

  nativeInstallCheckInputs = [
    versionCheckHook
    writableTmpDirAsHomeHook
  ];
  doInstallCheck = true;
  versionCheckKeepEnvironment = [ "HOME" "OPENCODE_DISABLE_MODELS_FETCH" ];
  versionCheckProgramArg = "--version";

  passthru = {
    env = finalAttrs.env;
  };

  meta = {
    description = "The open source coding agent";
    homepage = "https://opencode.ai";
    license = lib.licenses.mit;
    mainProgram = "genixcode-cli"; # fork_change - renamed binary
    inherit (node_modules.meta) platforms;
  };
})
