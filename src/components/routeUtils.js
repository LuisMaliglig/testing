// Inside ../components/routeUtils.js
import * as turf from "@turf/turf";

// --- Constants for Logic ---
// NOTE: Using more realistic values now. Adjust if needed for testing.
const MAX_WALK_TO_TRANSIT_KM = 1.5; // Max walk to/from stops (1.5km) - Still quite generous
const MAX_DISTANCE_FROM_STOP_TO_LINE_KM = 0.1; // How close must a line be to a stop/current position (100m)
const MIN_PROGRESS_RATIO = 0.1; // Heuristic for direction check: new distance must be < old distance * (1 - ratio)

// --- Fare Calculation Functions ---
// Note: Fare values and structures are illustrative examples and may need
// updating based on current official LTFRB/Operator fare matrices.
function calculateJeepFare(distanceKm) {
    const minimumFare = 13; // Example pesos
    const freeKilometers = 4;
    const additionalFarePerKm = 1.8; // Example

    if (distanceKm <= 0) return 0; // No negative distance
    if (distanceKm <= freeKilometers) {
        return minimumFare;
    } else {
        const extraKm = distanceKm - freeKilometers;
        // Jeepney fare often increments per whole km after first 4km
        return minimumFare + Math.ceil(extraKm) * additionalFarePerKm;
    }
}

function calculateBusFare(distanceKm) {
    // Simplified model (e.g., Ordinary City Bus)
    const baseFare = 15; // Example pesos
    const baseKm = 5;
    const additionalPerKm = 2.65; // Example

    if (distanceKm <= 0) return 0;
    if (distanceKm <= baseKm) {
        return baseFare;
    } else {
        const extraKm = distanceKm - baseKm;
        // Fare often increments per km after base distance
        return baseFare + Math.ceil(extraKm * additionalPerKm); // Check official rules for ceiling application
    }
}

function calculateMRTorLRTFare(distanceKm) {
     // Simplified distance tiers based on rough estimates. Real fares depend on station count.
     // Updated example tiers slightly
     if (distanceKm <= 0) return 0;
     if (distanceKm <= 2) return 13;    // Example Stored Value Fares
     if (distanceKm <= 5) return 16;
     if (distanceKm <= 8) return 20;
     if (distanceKm <= 12) return 24;
     if (distanceKm <= 16) return 28;
     if (distanceKm <= 20) return 30; // Example Max for MRT-3
     // Add more tiers or logic if needed
     return 30; // Default max if beyond known tiers
}

function calculateFare(mode, distanceMeters) {
    const distanceKm = distanceMeters / 1000;
    // P2P Bus fares often fixed - needs specific route data or a reasonable default.
    if (mode === 'P2P-Bus') {
        // You REALLY need actual data for P2P fares based on the route name if possible.
        // This is just a placeholder.
        return 150;
    }
    switch (mode) {
        case 'Jeep':
            return calculateJeepFare(distanceKm);
        case 'Bus':
            return calculateBusFare(distanceKm);
        case 'MRT':
        case 'LRT':
            return calculateMRTorLRTFare(distanceKm);
        case 'Walk':
        case 'Driving':
        default:
            return 0; // No fare for walking or direct driving in this context
    }
}


// --- Helper Function: Find Nearest Stop (ROBUST VERSION) ---
/**
 * Finds the nearest Point feature of specified types within a feature collection.
 * MORE ROBUST VERSION WITH INNER TRY-CATCH.
 * @param {Point} targetPoint Turf.js Point feature representing the search origin.
 * @param {Array<Feature>} transitFeatures Array of GeoJSON features (lines and points).
 * @param {Array<String>} allowedTypes Array of strings for properties.type to search for (e.g., ['Bus-Stop', 'MRT-Stop']).
 * @returns {{feature: Feature | null, distance: number}} The nearest feature and its distance (in kilometers), ALWAYS returns this object structure.
 */
function findNearestStop(targetPoint, transitFeatures, allowedTypes) {
  let nearestFeature = null;
  let minDistance = Infinity;

  // Stricter Input validation for targetPoint structure and other params
  if (!targetPoint || typeof targetPoint !== 'object' || targetPoint.type !== 'Feature' || targetPoint.geometry?.type !== 'Point' || !Array.isArray(targetPoint.geometry?.coordinates) || targetPoint.geometry.coordinates.length < 2 || typeof targetPoint.geometry.coordinates[0] !== 'number' || typeof targetPoint.geometry.coordinates[1] !== 'number' || isNaN(targetPoint.geometry.coordinates[0]) || isNaN(targetPoint.geometry.coordinates[1]) ||
      !Array.isArray(transitFeatures) || !Array.isArray(allowedTypes)) {
    console.error("findNearestStop: Invalid input.", { targetPoint: JSON.stringify(targetPoint), allowedTypes });
    return { feature: null, distance: Infinity }; // Return expected structure
  }

  // Outer try...catch for safety
  try {
    transitFeatures.forEach((feature, index) => {
      // Inner try...catch to handle errors with individual features
      try {
        // Check if it's a Point feature and has the allowed type property
        if (feature?.geometry?.type === 'Point' &&
            feature?.properties?.type &&
            allowedTypes.includes(feature.properties.type))
        {
          // Validate coordinates before using turf
          const coords = feature.geometry.coordinates;
          if (!Array.isArray(coords) || coords.length < 2 || typeof coords[0] !== 'number' || typeof coords[1] !== 'number' || isNaN(coords[0]) || isNaN(coords[1])) {
              // console.warn(`findNearestStop: Skipping feature index ${index} ('${feature?.properties?.name}') due to invalid coordinates:`, coords);
              return; // Skip this feature using return within forEach callback
          }

          const stopPoint = turf.point(coords); // Use validated coords
          const distance = turf.distance(targetPoint, stopPoint, { units: 'kilometers' });

          // Check if distance calculation returned a valid number
          if (typeof distance !== 'number' || isNaN(distance)) {
              // console.warn(`findNearestStop: Skipping feature index ${index} ('${feature?.properties?.name}') due to invalid distance calculation result:`, distance);
               return; // Skip this feature
          }

          if (distance < minDistance) {
            minDistance = distance;
            nearestFeature = feature;
          }
        }
      } catch (innerError) {
        // Log error for the specific feature but continue the loop
        console.error(`findNearestStop: Error processing feature index ${index} ('${feature?.properties?.name}'):`, innerError, "Feature Coords:", feature?.geometry?.coordinates);
      }
    }); // End forEach
  } catch (outerError) {
     console.error("findNearestStop: Unexpected outer error during processing:", outerError);
     return { feature: null, distance: Infinity }; // Ensure return structure on outer error
  }

  // Ensure the final return is always the object structure
  // console.log(`findNearestStop completed. Nearest: ${nearestFeature?.properties?.name}, Distance: ${minDistance === Infinity ? 'Infinity' : minDistance.toFixed(3)}`);
  return { feature: nearestFeature, distance: minDistance };
}


// --- Helper Function: Estimate Segment Duration ---
// Define Average Speeds (METERS PER SECOND) - ADJUST THESE BASED ON REALITY!
const AVG_WALKING_SPEED_MPS = 1.3;    // Approx 4.7 km/h
const AVG_JEEP_SPEED_MPS = 5.5;     // Approx 20 km/h (highly variable w/ traffic)
const AVG_BUS_SPEED_MPS = 8.0;      // Approx 30 km/h (variable)
const AVG_P2P_BUS_SPEED_MPS = 10.0; // Approx 36 km/h
const AVG_LRT_SPEED_MPS = 11.0;     // Approx 40 km/h
const AVG_MRT_SPEED_MPS = 12.5;     // Approx 45 km/h

// Define Estimated Wait/Transfer Times (SECONDS) - ADJUST THESE!
const ESTIMATED_WALK_TRANSFER_TIME_SEC = 120; // 2 minutes walk between modes/platforms
const ESTIMATED_TRANSIT_WAIT_TIME_SEC = 300; // 5 minutes average wait for next vehicle

/**
 * Estimates duration for a route segment based on mode and distance. VERY APPROXIMATE.
 * @param {String} mode Segment mode (e.g., 'Walk', 'Bus', 'MRT').
 * @param {number} distanceMeters Distance of the segment in meters.
 * @param {boolean} isFirstOrLastWalk Is this the very first or very last walking segment? (No transfer time added).
 * @param {boolean} isTransfer Is this segment a walk between modes? (Adds walk transfer time).
 * @returns {number} Estimated duration in seconds.
 */
function estimateSegmentDuration(mode, distanceMeters, isFirstOrLastWalk = false, isTransfer = false) {
  let speedMps;
  let additionalTimeSec = 0;

  // Normalize mode by removing '-Stop' suffix if present
  const cleanMode = mode?.replace('-Stop', '') || 'Walk';

  switch (cleanMode) {
    case 'Walk':
      speedMps = AVG_WALKING_SPEED_MPS;
      if (isTransfer && !isFirstOrLastWalk) {
         additionalTimeSec = ESTIMATED_WALK_TRANSFER_TIME_SEC;
      }
      break;
    case 'Jeep':
      speedMps = AVG_JEEP_SPEED_MPS;
      if (!isTransfer) additionalTimeSec = ESTIMATED_TRANSIT_WAIT_TIME_SEC;
      break;
    case 'Bus':
      speedMps = AVG_BUS_SPEED_MPS;
       if (!isTransfer) additionalTimeSec = ESTIMATED_TRANSIT_WAIT_TIME_SEC;
      break;
    case 'P2P-Bus':
      speedMps = AVG_P2P_BUS_SPEED_MPS;
       if (!isTransfer) additionalTimeSec = ESTIMATED_TRANSIT_WAIT_TIME_SEC;
      break;
    case 'LRT':
      speedMps = AVG_LRT_SPEED_MPS;
       if (!isTransfer) additionalTimeSec = ESTIMATED_TRANSIT_WAIT_TIME_SEC;
      break;
    case 'MRT':
      speedMps = AVG_MRT_SPEED_MPS;
       if (!isTransfer) additionalTimeSec = ESTIMATED_TRANSIT_WAIT_TIME_SEC;
      break;
    default:
      console.warn(`Estimating duration for unknown mode "${mode}" using walking speed.`);
      speedMps = AVG_WALKING_SPEED_MPS;
  }

  // Calculate travel time based on distance and speed
  let travelTimeSec = 0;
  if (distanceMeters > 0 && speedMps && speedMps > 0) {
      travelTimeSec = distanceMeters / speedMps;
  } else if (distanceMeters > 0) {
      // Handle case where speed might be zero or invalid, avoid Infinity
      console.warn(`Invalid speed (${speedMps}) for mode ${mode}, cannot calculate travel time accurately.`);
      travelTimeSec = 0; // Or assign a penalty time?
  }

  // Return total time (travel + wait/transfer)
  return travelTimeSec + additionalTimeSec;
}


// --- Helper Function: tryBuildTransitRoute (WITH COMBINED GEOMETRY & DEBUG LOGS) ---
/**
 * Attempts to build a single transit route option focusing on specific modes.
 * Returns a route object if successful, null otherwise.
 */
function tryBuildTransitRoute(startPoint, endPoint, transitFeatures, allowedLineTypes, primaryModeLabel) {
    console.log(`Attempting to build route prioritizing: ${allowedLineTypes.join(', ')}`);

    try { // Wrap point access in try-catch just in case startPoint/endPoint are malformed
         console.log(` -> Start Point Coords: ${JSON.stringify(startPoint?.geometry?.coordinates)}`);
         console.log(` -> End Point Coords: ${JSON.stringify(endPoint?.geometry?.coordinates)}`);
    } catch (e) { console.error("Error logging points:", e)}

    let currentPosition = startPoint;
    let accumulatedSegments = []; // Will store segments WITH geometry
    let transitLegAdded = false;

    // Determine compatible stop types...
    const allowedStopTypes = allowedLineTypes.flatMap(type => {
         if (type === 'MRT' || type === 'LRT' || type === 'Bus' || type === 'P2P-Bus') { return [`${type}-Stop`]; }
         return [];
     }).filter(Boolean);
    if (allowedLineTypes.includes('Bus') || allowedLineTypes.includes('P2P-Bus')) { if (!allowedStopTypes.includes('Bus-Stop')) { allowedStopTypes.push('Bus-Stop'); } }
    const requiresStartStop = !(allowedStopTypes.length === 0 && allowedLineTypes.includes('Jeep'));
    console.log(` -> Requires Start Stop: ${requiresStartStop}, Allowed Stop Types: [${allowedStopTypes.join(', ')}]`);
    if (allowedStopTypes.length === 0 && !allowedLineTypes.includes('Jeep')) {
        console.log(` -> EXITED EARLY: No stop types defined for allowed lines: [${allowedLineTypes.join(', ')}].`);
        return null;
    }

    // 1. Find nearest START stop (if required)
    if (requiresStartStop) {
        console.log(` -> Calling findNearestStop for types [${allowedStopTypes.join(', ')}] near ${JSON.stringify(startPoint?.geometry?.coordinates)}`);
        const nearestStartStopInfo = findNearestStop(startPoint, transitFeatures, allowedStopTypes);
        console.log(` -> findNearestStop Result: ${JSON.stringify(nearestStartStopInfo)}`);

        if (nearestStartStopInfo && nearestStartStopInfo.feature && nearestStartStopInfo.distance <= MAX_WALK_TO_TRANSIT_KM) {
            const startStopFeature = nearestStartStopInfo.feature;
            const startStopPoint = turf.point(startStopFeature.geometry.coordinates);
            console.log(` -> Found nearby start stop: ${startStopFeature.properties.name} (${startStopFeature.properties.type})`);
            const walkToStopDist = nearestStartStopInfo.distance * 1000;
            const walkToStopTime = estimateSegmentDuration('Walk', walkToStopDist, true, false);
            // *** Ensure geometry is added ***
            const walkToStopGeometry = turf.lineString([startPoint.geometry.coordinates, startStopPoint.geometry.coordinates]);
            accumulatedSegments.push({
                mode: 'Walk', label: `Walk to ${startStopFeature.properties.name || 'start'}`, distance: walkToStopDist,
                duration: walkToStopTime, fare: 0,
                geometry: walkToStopGeometry.geometry // Store the geometry object
            });
            currentPosition = startStopPoint; // Update position to the stop
        } else {
            console.log(` -> EXITED: No suitable start stop found within ${MAX_WALK_TO_TRANSIT_KM} km for modes [${allowedLineTypes.join(', ')}].`);
             if (nearestStartStopInfo) { console.log(`   (Nearest stop distance was: ${nearestStartStopInfo.distance === Infinity ? 'Infinity' : nearestStartStopInfo.distance.toFixed(3)} km)`); }
             else { console.log(`   (findNearestStop itself returned unexpected value: ${nearestStartStopInfo})`); }
            return null; // Cannot start this transit route type
        }
    } else {
        console.log(` -> No specific start stops required for ${allowedLineTypes.join(', ')}. Checking line proximity from origin.`);
        currentPosition = startPoint; // Start checking lines from the original start point
    }


    // 2. Find BEST line and Create TRANSIT segment (with geometry)
    let bestLineOption = null;
    const candidateLines = transitFeatures.filter(f => f?.geometry?.type === 'LineString' && f?.properties?.type && allowedLineTypes.includes(f.properties.type));
    console.log(` -> Checking ${candidateLines.length} candidate lines of type(s) [${allowedLineTypes.join(', ')}] near current pos: ${JSON.stringify(currentPosition?.geometry?.coordinates)}`);

    for (const line of candidateLines) {
        try {
            const nearestOnLine = turf.nearestPointOnLine(line, currentPosition, { units: 'kilometers' });
            if (!nearestOnLine || nearestOnLine.properties.dist > MAX_DISTANCE_FROM_STOP_TO_LINE_KM) { continue; }
            const entryPointOnLine = nearestOnLine;
            const exitPointOnLine = turf.nearestPointOnLine(line, endPoint, { units: 'kilometers' });
            if (!exitPointOnLine) continue;

            // --- MODIFIED Direction & Progress Check ---
            const distBetweenEntryExit = turf.distance(entryPointOnLine, exitPointOnLine, { units: 'kilometers' });
            if (distBetweenEntryExit > 0.01) { // Only consider if points are > 10m apart
                const distToDestViaExit = turf.distance(exitPointOnLine, endPoint, { units: 'kilometers' });
                const distToDestViaEntry = turf.distance(entryPointOnLine, endPoint, { units: 'kilometers' });
                const threshold = distToDestViaEntry * (1.0 - MIN_PROGRESS_RATIO);
                // console.log(`    -> Checking Line: ${line.properties.name} (${line.properties.type}) | Progress Check: Is ${distToDestViaExit.toFixed(2)} < ${threshold.toFixed(2)}? (${distToDestViaExit < threshold})`);

                if (distToDestViaExit < threshold) {
                    const segmentOnLine = turf.lineSlice(entryPointOnLine, exitPointOnLine, line);
                    if (!segmentOnLine?.geometry?.coordinates || segmentOnLine.geometry.coordinates.length < 2) {
                         console.warn(`       -> lineSlice failed for ${line.properties.name}. Skipping.`); continue;
                    }
                    const segmentDistanceKm = turf.length(segmentOnLine, { units: 'kilometers' });
                    if (!bestLineOption || segmentDistanceKm < bestLineOption.distanceKm) {
                         bestLineOption = { line, entryPointOnLine, exitPointOnLine, distanceKm: segmentDistanceKm };
                         console.log(`       -> Candidate selected (provisional): ${line.properties.name}, On-line Dist: ${segmentDistanceKm.toFixed(2)}km`);
                    }
                }
                // else { console.log(`    -> FAILED progress check (Not significantly closer).`); }
            }
            // else { console.log(`    -> SKIPPED line ${line.properties.name} (Entry/Exit too close).`); }
            // --- End MODIFIED Check ---

        } catch(lineError) { console.error(`Error processing candidate line ${line?.properties?.name}:`, lineError); }
    } // End loop

    // 3. Create Transit Segment if a line was selected
    if (bestLineOption) {
        const { line, entryPointOnLine, exitPointOnLine, distanceKm } = bestLineOption;
        console.log(` -> Selected transit leg: ${line.properties.name} (${line.properties.type})`);
        const transitDist = distanceKm * 1000;
        const mode = line.properties.type;
        const transitTime = estimateSegmentDuration(mode, transitDist, false, false);
        const transitFare = calculateFare(mode, transitDist);
        // *** Ensure geometry is calculated and added ***
        const transitSegmentGeometry = turf.lineSlice(entryPointOnLine, exitPointOnLine, line);

        if (!transitSegmentGeometry?.geometry?.coordinates || transitSegmentGeometry.geometry.coordinates.length < 2) {
             console.error(` -> Failed to slice geometry for selected transit leg: ${line.properties.name}. Discarding option.`);
             return null;
        }
        accumulatedSegments.push({
            mode: mode, label: `Take ${line.properties.name || mode}`, distance: transitDist,
            duration: transitTime, fare: transitFare,
            geometry: transitSegmentGeometry.geometry // Store geometry
        });

        // Update position based on exit stop/point
        let exitPosition = turf.point(exitPointOnLine.geometry.coordinates);
        if(allowedStopTypes.length > 0) {
            const nearestEndStopInfo = findNearestStop(exitPosition, transitFeatures, allowedStopTypes);
            if (nearestEndStopInfo && nearestEndStopInfo.feature && nearestEndStopInfo.distance <= MAX_WALK_TO_TRANSIT_KM / 2) {
                 console.log(` -> Exiting near stop: ${nearestEndStopInfo.feature.properties.name}`);
                 exitPosition = turf.point(nearestEndStopInfo.feature.geometry.coordinates);
            } else { console.log(` -> No specific stop found very near exit point on line.`); }
        } else { console.log(` -> No specific stops for mode ${mode}. Using line exit point.`); }
        currentPosition = exitPosition;
        transitLegAdded = true;
    } else {
        console.log(` -> EXITED: No suitable line found for mode(s): [${allowedLineTypes.join(', ')}] connecting start/end areas.`);
        return null;
    }

    // 4. Final Walking Segment
    if (transitLegAdded) {
        const walkFromStopDist = turf.distance(currentPosition, endPoint, { units: 'meters' });
        if ((walkFromStopDist / 1000) <= MAX_WALK_TO_TRANSIT_KM * 1.5) {
            const walkFromStopTime = estimateSegmentDuration('Walk', walkFromStopDist, true, false);
            // *** Ensure geometry is added ***
            const finalWalkGeometry = turf.lineString([currentPosition.geometry.coordinates, endPoint.geometry.coordinates]);
            accumulatedSegments.push({
                mode: 'Walk', label: `Walk to Destination`, distance: walkFromStopDist,
                duration: walkFromStopTime, fare: 0,
                geometry: finalWalkGeometry.geometry // Store geometry
            });
        } else {
            console.log(` -> EXITED: Final walk (${(walkFromStopDist / 1000).toFixed(2)} km) is too long. Discarding ${primaryModeLabel} option.`);
            return null;
        }
    } else {
        console.log(` -> EXITED: Cannot add final walk as no transit leg was added.`);
        return null;
    }


    // --- 5. REVISED: Assemble Combined Geometry (Simpler Concatenation) ---
    console.log(" -> Assembling combined geometry...");
    let combinedCoordinates = [];
    // let previousEndPoint = null; // Not needed for simple concat + cleanup

    if (Array.isArray(accumulatedSegments) && accumulatedSegments.length > 0) {
        console.log(`   - Processing ${accumulatedSegments.length} segments for geometry combination.`);
        accumulatedSegments.forEach((seg, index) => {
            // Log details of each segment being processed
            // console.log(`   - Segment ${index}: Mode=${seg?.mode}, Label='${seg?.label}', Coords=${Array.isArray(seg?.geometry?.coordinates) ? seg.geometry.coordinates.length : 'INVALID'}`);

            if (!seg?.geometry?.coordinates || !Array.isArray(seg.geometry.coordinates) || seg.geometry.coordinates.length === 0) {
                console.warn(`   - Segment ${index} (${seg?.mode}) has invalid or missing geometry. Skipping.`);
                return; // Skip this segment's geometry
            }

            const segmentCoords = seg.geometry.coordinates;

            // Simply add all coordinates from this segment
            combinedCoordinates.push(...segmentCoords);
            // console.log(`     -> Appended ${segmentCoords.length} coords from segment ${index}. New total: ${combinedCoordinates.length}`);

        }); // End forEach segment

        // Clean up potential consecutive duplicate points AFTER concatenation
        if (combinedCoordinates.length > 1) {
            let originalLength = combinedCoordinates.length;
            let cleanedCoordinates = [combinedCoordinates[0]]; // Start with the first point
            for (let i = 1; i < combinedCoordinates.length; i++) {
                // Check if the current point is different from the last added point (basic check)
                if (combinedCoordinates[i][0] !== cleanedCoordinates[cleanedCoordinates.length - 1][0] ||
                    combinedCoordinates[i][1] !== cleanedCoordinates[cleanedCoordinates.length - 1][1]) {
                    cleanedCoordinates.push(combinedCoordinates[i]);
                }
            }
            combinedCoordinates = cleanedCoordinates;
            console.log(`   - Cleaned duplicates: ${originalLength} -> ${combinedCoordinates.length} points.`);
        }

    } // End if accumulatedSegments

    console.log(` -> Total final combined coordinates: ${combinedCoordinates.length}`);
    // console.log(` -> Final Coords Snippet: ${JSON.stringify(combinedCoordinates.slice(0, 3))}...${JSON.stringify(combinedCoordinates.slice(-3))}`);


    // Create the final geometry object IF coordinates form a valid line
    const finalRouteGeometry = combinedCoordinates.length >= 2 ? turf.lineString(combinedCoordinates).geometry : null;
    if (!finalRouteGeometry) {
         console.warn(` -> Could not generate valid combined geometry for ${primaryModeLabel} option. Route will lack map display.`);
    } else {
         console.log(` -> Successfully generated combined geometry.`);
    }
    // --- End Combined Geometry ---


    // 6. Assemble final route object, including combined geometry
    const totalDuration = accumulatedSegments.reduce((sum, s) => sum + (s?.duration || 0), 0);
    const totalDistance = accumulatedSegments.reduce((sum, s) => sum + (s?.distance || 0), 0);
    const totalFare = accumulatedSegments.reduce((sum, s) => sum + (s?.fare || 0), 0);
    return {
        type: "Feature",
        properties: {
            label: `Route via ${primaryModeLabel} (Est. ${(totalDuration / 60).toFixed(0)} min, P${totalFare.toFixed(2)})`,
            segments: accumulatedSegments, // Keep segment details (now including geometry)
            summary_duration: totalDuration,
            summary_distance: totalDistance,
            total_fare: totalFare,
            primary_mode: primaryModeLabel
        },
        geometry: finalRouteGeometry // *** Assign the combined geometry ***
    };
} // End tryBuildTransitRoute


// --- Helper Function: buildDirectRouteOption (CORRECTED) ---
/**
 * Creates the route option object for the direct driving route.
 * Ensures the segment within properties also has geometry.
 */
function buildDirectRouteOption(awsRouteData, startPoint, endPoint) {
     if (!awsRouteData?.Summary || !awsRouteData?.Legs?.[0]?.Geometry?.LineString) {
        console.error("buildDirectRouteOption: Invalid AWS route data.");
        return null;
     }
     const awsRouteGeometry = awsRouteData.Legs[0].Geometry.LineString;
     if (!Array.isArray(awsRouteGeometry) || awsRouteGeometry.length < 2) {
        console.error("buildDirectRouteOption: Invalid AWS route geometry.");
        return null;
     }

     // Create the Turf lineString to easily get geometry object and length
     const awsRouteLine = turf.lineString(awsRouteGeometry);
     const totalAwsDistanceMeters = turf.length(awsRouteLine, { units: 'meters' });

     // Create the single segment for the driving route
     const directSegments = [
         {
             mode: 'Driving',
             label: 'Direct Route',
             distance: totalAwsDistanceMeters,
             duration: awsRouteData.Summary.DurationSeconds,
             fare: 0,
             // *** FIX: Assign the geometry object to the segment ***
             geometry: awsRouteLine.geometry // Use the geometry from the turf object
         }
     ];

     // Log the segment being created for debugging
     // console.log("Direct route segment created:", JSON.stringify(directSegments[0]));

     // Return the full Feature object
     return {
         type: "Feature",
         properties: {
             label: `Direct Route (AWS Est: ${(awsRouteData.Summary.DurationSeconds / 60).toFixed(0)} min)`,
             segments: directSegments, // The array containing the segment with geometry
             summary_duration: awsRouteData.Summary.DurationSeconds,
             summary_distance: totalAwsDistanceMeters,
             total_fare: 0,
             primary_mode: 'Driving'
         },
         geometry: awsRouteLine.geometry // Keep top-level geometry for overall bounds calculation etc.
     };
}


// --- Main Exported Function ---
export function buildSnappedRouteData(awsRouteData, transitFeatures) {
    console.log("Starting buildSnappedRouteData - Generating multiple options...");
    let finalRouteOptions = [];

    // Validate essential inputs early
    if (!awsRouteData?.Legs?.[0]?.Geometry?.LineString || !Array.isArray(transitFeatures)) {
        console.error("buildSnappedRouteData: Missing necessary AWS geometry or transitFeatures. Cannot generate routes.");
        return [];
    }
    const awsRouteGeometry = awsRouteData.Legs[0].Geometry.LineString;
    if (!Array.isArray(awsRouteGeometry) || awsRouteGeometry.length < 2) {
        console.error("buildSnappedRouteData: Invalid AWS route geometry. Cannot generate routes.");
        return [];
    }
    const startPoint = turf.point(awsRouteGeometry[0]);
    const endPoint = turf.point(awsRouteGeometry[awsRouteGeometry.length - 1]);


    // --- Attempt to build route for each prioritized mode group ---
    const modesToTry = [
        { types: ['MRT'], label: 'MRT' },
        { types: ['LRT'], label: 'LRT' },
        { types: ['Bus', 'P2P-Bus'], label: 'Bus' },
        { types: ['Jeep'], label: 'Jeep' }
    ];

    modesToTry.forEach(modeGroup => {
        try {
            const option = tryBuildTransitRoute(startPoint, endPoint, transitFeatures, modeGroup.types, modeGroup.label);
            if (option) {
                finalRouteOptions.push(option);
            }
        } catch (error) {
             console.error(`Error generating route option for mode ${modeGroup.label}:`, error);
        }
    });


    // --- Always Add Direct Driving Route ---
    try {
        const directOption = buildDirectRouteOption(awsRouteData, startPoint, endPoint);
        if (directOption) {
            finalRouteOptions.push(directOption);
        } else {
            console.warn("Could not generate Direct Route option.");
        }
    } catch(error) {
        console.error("Error building direct route option:", error);
    }


    // --- Refine/Filter Results ---
    const uniqueOptions = [];
    const seenLabels = new Set();
    for (const option of finalRouteOptions) {
        if (option?.properties?.label) {
            if (!seenLabels.has(option.properties.label)) {
                uniqueOptions.push(option);
                seenLabels.add(option.properties.label);
            } else {
                 console.log(`Skipping duplicate route label: ${option.properties.label}`);
            }
        } else if (option) {
             console.warn("Found route option without a label:", option);
        }
    }

    // Sort options: Prioritize lower duration, then lower fare
    uniqueOptions.sort((a, b) => {
        const durationA = a?.properties?.summary_duration ?? Infinity;
        const durationB = b?.properties?.summary_duration ?? Infinity;
        if (durationA !== durationB) { return durationA - durationB; }
        const fareA = a?.properties?.total_fare ?? Infinity;
        const fareB = b?.properties?.total_fare ?? Infinity;
        return fareA - fareB;
    });


    console.log(`buildSnappedRouteData finished. Returning ${uniqueOptions.length} unique options:`, uniqueOptions.map(o=>o?.properties?.label || 'Invalid Label')); // Log labels safely
    return uniqueOptions;
}