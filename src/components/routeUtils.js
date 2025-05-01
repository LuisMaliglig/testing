export function buildSnappedRouteData(awsRouteData, transitFeatures) {
    if (!awsRouteData || !awsRouteData.Legs) {
      console.error("Invalid AWS route data:", awsRouteData); // Debug log
      return [];
    }
  
    const snappedRouteData = [];
  
    awsRouteData.Legs.forEach((leg) => {
      if (leg.Steps && Array.isArray(leg.Steps)) {
        leg.Steps.forEach((step) => {
          if (step.StartPosition && step.EndPosition) {
            // Manually create a LineString from StartPosition and EndPosition
            const lineString = {
              type: "LineString",
              coordinates: [step.StartPosition, step.EndPosition],
            };
  
            snappedRouteData.push(lineString);
          } else {
            console.warn("Missing StartPosition or EndPosition in step:", step); // Warn if positions are missing
          }
        });
      } else {
        console.warn("Invalid or missing steps in the leg:", leg); // Warn if steps are missing or not an array
      }
    });
  
    return snappedRouteData;
  }
  