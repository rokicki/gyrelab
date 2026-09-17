import {
  getPuzzleDescriptionString,
  getPuzzleGeometryByDesc,
} from "cubing/puzzle-geometry";
import {
  setTwistyDebug,
  TwistyPlayer,
  type TwistyPlayerConfig,
} from "cubing/twisty";
import { setupPropInputs } from "./prop-inputs";
import { getURLParam, setAlgParam } from "./url-params";

interface OrbitCoordinates {
  latitude: number;
  longitude: number;
  distance: number;
}

// Twizzle URL parameters and the TwistyPlayer config fields they set (as
// cubing.js's internal getConfigFromURL does).
const URL_PARAM_TO_CONFIG: Record<string, keyof TwistyPlayerConfig> = {
  alg: "alg",
  "setup-alg": "experimentalSetupAlg",
  "setup-anchor": "experimentalSetupAnchor",
  puzzle: "puzzle",
  stickering: "experimentalStickering",
  "puzzle-description": "experimentalPuzzleDescription",
  title: "experimentalTitle",
  "video-url": "experimentalVideoURL",
  competition: "experimentalCompetitionID",
};

function getConfigFromURL(): TwistyPlayerConfig {
  const params = new URL(location.href).searchParams;
  const config: Record<string, string> = {};
  for (const [param, key] of Object.entries(URL_PARAM_TO_CONFIG)) {
    const value = params.get(param);
    if (value !== null) {
      config[key] = value;
    }
  }
  return config as TwistyPlayerConfig;
}

/** Latitude and longitude (degrees) and distance for a camera position. */
function positionToOrbitCoordinates([x, y, z]: number[]): OrbitCoordinates {
  const distance = Math.hypot(x, y, z);
  const degrees = 180 / Math.PI;
  return {
    latitude: 90 - Math.acos(Math.max(-1, Math.min(1, y / distance))) * degrees,
    longitude: Math.atan2(x, z) * degrees,
    distance,
  };
}

export function constructTwistyPlayer(): TwistyPlayer {
  if (getURLParam("debug-show-render-stats")) {
    setTwistyDebug({ showRenderStats: true });
  }

  const config = getConfigFromURL();
  console.log(config);
  config.experimentalPuzzleDescription ??= getPuzzleDescriptionString(
    config.puzzle ?? "3x3x3",
  );
  delete config["puzzle"];
  const explorerConfig: TwistyPlayerConfig = {
    cameraLatitudeLimit: 90,
    viewerLink: "none",
    experimentalMovePressInput: "basic",
    experimentalMovePressCancelOptions: {
      directional: "any-direction",
      puzzleSpecificModWrap: "gravity",
    },
    hintFacelets: "none",
  };
  Object.assign(config, explorerConfig);
  const twistyPlayer = new TwistyPlayer(config);

  const initialCameraOrbitCoordinatesPromise = cameraCoords(
    config.experimentalPuzzleDescription ?? "c", // TODO
  );
  // TODO
  twistyPlayer.experimentalModel.twistySceneModel.orbitCoordinatesRequest.set(
    initialCameraOrbitCoordinatesPromise,
  );

  setupPropInputs(twistyPlayer);
  twistyPlayer.experimentalModel.alg.addFreshListener((algWithIssues) => {
    setAlgParam("alg", algWithIssues.alg.toString());
  });
  return twistyPlayer;
}

const platonicShapeToGeoTowardsViewer: Record<string, string> = {
  t: "FLR",
  c: "URF",
  o: "FLUR",
  d: "F",
  i: "F",
};
async function cameraCoords(desc: string): Promise<OrbitCoordinates> {
  const pg = getPuzzleGeometryByDesc(desc); // TODO: Avoid this
  const platonicShape = desc[0];
  const geoTowardsViewer = platonicShapeToGeoTowardsViewer[platonicShape];

  if (!geoTowardsViewer) {
    throw new Error("invalid shape for coords");
  }
  const norm = pg.getGeoNormal(geoTowardsViewer);
  if (!norm) {
    throw new Error("invalid normal");
  }
  return positionToOrbitCoordinates(norm.map((c) => c * 6));
}
