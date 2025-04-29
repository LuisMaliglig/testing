export const awsConfig = {
    region: "ap-southeast-1",
    apiKey: process.env.REACT_APP_API_KEY,
    mapName: "explore.map.Grab",
    routeCalculatorName: "explore.route-calculator.Grab",
    placeIndex: "explore.place.Grab",
    identityPoolId: process.env.REACT_APP_IDENTITY_POOL_ID,
  };

export const mapboxConfig = {
  accessToken: process.env.MAPBOX_API_KEY,
};