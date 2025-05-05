// Inside ../components/routeUtils.js
import * as turf from "@turf/turf";

// --- Constants for Logic ---
const MAX_WALK_TO_TRANSIT_KM = 1.5; // Max walk to/from stops (1.5km)
const MAX_DISTANCE_FROM_STOP_TO_LINE_KM = 0.1; // How close line must be to stop/pos (100m)
const MIN_PROGRESS_RATIO = 0.1; // Heuristic: Must reduce distance to dest by at least 10%
const MAX_BEARING_DIFFERENCE_DEGREES = 80; // Max bearing deviation for Bus/Jeep

// --- Speed Constants (Kilometers per Hour - KPH) ---
const AVG_WALKING_SPEED_KPH = 4.7;
const AVG_JEEP_SPEED_KPH = 20.0;
const AVG_BUS_SPEED_KPH = 30.0;
const AVG_P2P_BUS_SPEED_KPH = 36.0;
const AVG_LRT_SPEED_KPH = 60.0; // User specified
const AVG_MRT_SPEED_KPH = 45.0; // User specified

// Define Estimated Wait/Transfer Times (SECONDS)
const ESTIMATED_WALK_TRANSFER_TIME_SEC = 120; // 2 minutes
const ESTIMATED_TRANSIT_WAIT_TIME_SEC = 300; // 5 minutes

// --- Fare Calculation Functions ---

/**
 * Calculates Jeepney fare based on distance.
 * @param {number} distanceKm - Distance in kilometers.
 * @returns {number} Fare in pesos, rounded to nearest whole number.
 */
function calculateJeepFare(distanceKm) {
    const minimumFare = 13;
    const freeKilometers = 4;
    const additionalFarePerKm = 1.8;
    if (distanceKm <= 0) return 0;
    if (distanceKm <= freeKilometers) {
        return minimumFare;
    } else {
        const extraKm = distanceKm - freeKilometers;
        const calculatedFare = minimumFare + Math.ceil(extraKm) * additionalFarePerKm;
        return Math.round(calculatedFare);
    }
}

/**
 * Calculates Bus fare based on distance (simplified).
 * @param {number} distanceKm - Distance in kilometers.
 * @returns {number} Fare in pesos, rounded to nearest 0.25.
 */
function calculateBusFare(distanceKm) {
    const baseFare = 15;
    const baseKm = 5;
    const additionalPerKm = 2.65;
    if (distanceKm <= 0) return 0;
    if (distanceKm <= baseKm) {
        // Base fare might need rounding if not ending in .00 or .50 based on rules
        return Math.round(baseFare * 4) / 4;
    } else {
        const extraKm = distanceKm - baseKm;
        // Ceiling applied per km based on some fare matrices
        const calculatedFare = baseFare + Math.ceil(extraKm * additionalPerKm);
        return Math.round(calculatedFare * 4) / 4;
    }
}

/**
 * Calculates LRT fare based on distance.
 * @param {number} distanceKm - Distance in kilometers.
 * @returns {number} Fare in pesos, rounded to nearest whole number.
 */
function calculateLRTFare(distanceKm) {
    const baseFare = 16.25; // Base fare might apply differently, check rules
    const additionalPerKm = 1.47;
    if (distanceKm <= 0) return 0;
    // Apply additional fare for the entire distance for simplicity
    const calculatedFare = baseFare + (Math.max(0, distanceKm) * additionalPerKm);
    return Math.round(calculatedFare);
}

/**
 * Calculates MRT fare based on approximate distance tiers.
 * NOTE: This is an approximation of a station-count based system.
 * @param {number} distanceKm - Distance in kilometers.
 * @returns {number} Fare in pesos.
 */
function calculateMRTFare(distanceKm) {
    if (distanceKm <= 0) return 0;
    if (distanceKm <= 3) return 13;    // Approx 1-2 stations
    if (distanceKm <= 6) return 16;    // Approx 3-4 stations
    if (distanceKm <= 10) return 20;   // Approx 5-7 stations
    if (distanceKm <= 14) return 24;   // Approx 8-10 stations
    return 28;                         // Approx >10 stations
}

/**
 * Main fare calculation dispatcher.
 * @param {string} mode - The mode of transport (e.g., 'Bus', 'MRT').
 * @param {number} distanceMeters - Distance in meters.
 * @returns {number} Calculated fare in pesos.
 */
function calculateFare(mode, distanceMeters) {
    const distanceKm = distanceMeters / 1000;
    if (mode === 'P2P-Bus') { return 150; /* Placeholder fixed fare */ }
    switch (mode) {
        case 'Jeep': return calculateJeepFare(distanceKm);
        case 'Bus': return calculateBusFare(distanceKm);
        case 'MRT': return calculateMRTFare(distanceKm);
        case 'LRT1': case 'LRT2': return calculateLRTFare(distanceKm); // Use same LRT logic for both
        case 'Walk': case 'Driving': default: return 0;
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


// --- Helper Function: Estimate Segment Duration (Using KPH) ---
/**
 * Estimates duration for a route segment based on mode and distance.
 * Uses KPH constants and returns total time in SECONDS.
 */
function estimateSegmentDuration(mode, distanceMeters, isFirstOrLastWalk = false, isTransfer = false) {
  let speedKph;
  let additionalTimeSec = 0;
  const distanceKm = distanceMeters / 1000; // Convert distance to KM for calculation

  // Normalize mode by removing '-Stop' suffix if present
  const cleanMode = mode?.replace('-Stop', '') || 'Walk';

  // Assign speed based on mode
  switch (cleanMode) {
    case 'Walk': speedKph = AVG_WALKING_SPEED_KPH; break;
    case 'Jeep': speedKph = AVG_JEEP_SPEED_KPH; break;
    case 'Bus': speedKph = AVG_BUS_SPEED_KPH; break;
    case 'P2P-Bus': speedKph = AVG_P2P_BUS_SPEED_KPH; break;
    case 'LRT1': case 'LRT2': speedKph = AVG_LRT_SPEED_KPH; break; // Use updated KPH
    case 'MRT': speedKph = AVG_MRT_SPEED_KPH; break; // Use updated KPH
    default: console.warn(`Estimating duration for unknown mode "${mode}"...`); speedKph = AVG_WALKING_SPEED_KPH;
  }

  // Add wait/transfer time
  if (cleanMode === 'Walk') {
    if (isTransfer && !isFirstOrLastWalk) { additionalTimeSec = ESTIMATED_WALK_TRANSFER_TIME_SEC; }
  } else { // For transit modes
    if (!isTransfer) { additionalTimeSec = ESTIMATED_TRANSIT_WAIT_TIME_SEC; }
  }

  // Calculate travel time in SECONDS
  let travelTimeSec = 0;
  if (distanceKm > 0 && speedKph && speedKph > 0) {
      const travelTimeHours = distanceKm / speedKph; // Time = Distance / Speed
      travelTimeSec = travelTimeHours * 3600; // Convert hours to seconds
  } else if (distanceKm > 0) {
      console.warn(`Invalid speed (${speedKph}) for mode ${mode}...`); travelTimeSec = 0;
  }

  // Return total time (travel + wait/transfer)
  return travelTimeSec + additionalTimeSec;
}


// --- Helper Function: tryBuildTransitRoute (WITH P2P HANDLING & CONDITIONAL DIRECTION CHECK) ---
/**
 * Attempts to build a single transit route option focusing on specific modes.
 * Returns a route object if successful, null otherwise.
 */
function tryBuildTransitRoute(startPoint, endPoint, transitFeatures, allowedLineTypes, primaryModeLabel) {
    console.log(`Attempting to build route prioritizing: ${allowedLineTypes.join(', ')}`);

    try {
         console.log(` -> Start Point Coords: ${JSON.stringify(startPoint?.geometry?.coordinates)}`);
         console.log(` -> End Point Coords: ${JSON.stringify(endPoint?.geometry?.coordinates)}`);
    } catch (e) { console.error("Error logging points:", e)}

    let currentPosition = startPoint;
    let accumulatedSegments = [];
    let transitLegAdded = false;

    // Determine compatible stop types...
    const allowedStopTypes = allowedLineTypes.flatMap(type => {
         if (type === 'MRT' || type === 'LRT1' || type === 'LRT2' || type === 'Bus' || type === 'P2P-Bus') { return [`${type}-Stop`, 'Bus-Stop']; }
         return [];
     }).filter((value, index, self) => self.indexOf(value) === index);
    if (allowedLineTypes.includes('Bus') && !allowedStopTypes.includes('Bus-Stop')) { allowedStopTypes.push('Bus-Stop'); }
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
            const walkToStopGeometry = turf.lineString([startPoint.geometry.coordinates, startStopPoint.geometry.coordinates]);
            accumulatedSegments.push({
                mode: 'Walk', label: `Walk to ${startStopFeature.properties.name || 'start'}`, distance: walkToStopDist,
                duration: walkToStopTime, fare: 0,
                geometry: walkToStopGeometry.geometry
            });
            currentPosition = startStopPoint;
        } else {
            console.log(` -> EXITED: No suitable start stop found within ${MAX_WALK_TO_TRANSIT_KM} km.`);
             if (nearestStartStopInfo) { console.log(`   (Nearest stop distance was: ${nearestStartStopInfo.distance === Infinity ? 'Infinity' : nearestStartStopInfo.distance.toFixed(3)} km)`); }
             else { console.log(`   (findNearestStop itself returned unexpected value: ${nearestStartStopInfo})`); }
            return null;
        }
    } else {
        console.log(` -> No specific start stops required for ${allowedLineTypes.join(', ')}. Checking line proximity from origin.`);
        currentPosition = startPoint;
    }


    // 2. Find BEST line and Create TRANSIT segment (with geometry)
    let bestLineOption = null;
    const candidateLines = transitFeatures.filter(f => f?.geometry?.type === 'LineString' && f?.properties?.type && allowedLineTypes.includes(f.properties.type));
    console.log(` -> Checking ${candidateLines.length} candidate lines of type(s) [${allowedLineTypes.join(', ')}] near current pos: ${JSON.stringify(currentPosition?.geometry?.coordinates)}`);

    for (const line of candidateLines) {
        try {
            const isP2P = line.properties.type === 'P2P-Bus';
            const isRail = ['MRT', 'LRT1', 'LRT2'].includes(line.properties.type);
            let entryPointOnLine, exitPointOnLine;

            // Entry/Exit points
            if (isP2P) {
                 if (!line.geometry?.coordinates || line.geometry.coordinates.length < 2) { continue; }
                 entryPointOnLine = turf.point(line.geometry.coordinates[0]);
                 exitPointOnLine = turf.point(line.geometry.coordinates[line.geometry.coordinates.length - 1]);
                 const distToP2PStart = turf.distance(currentPosition, entryPointOnLine, { units: 'kilometers' });
                 if (distToP2PStart > MAX_DISTANCE_FROM_STOP_TO_LINE_KM * 2) { continue; }
            } else {
                const nearestOnLine = turf.nearestPointOnLine(line, currentPosition, { units: 'kilometers' });
                if (!nearestOnLine || nearestOnLine.properties.dist > MAX_DISTANCE_FROM_STOP_TO_LINE_KM) { continue; }
                entryPointOnLine = nearestOnLine;
                exitPointOnLine = turf.nearestPointOnLine(line, endPoint, { units: 'kilometers' });
                if (!exitPointOnLine) continue;
            }

            // --- ENHANCED Direction & Progress Check ---
            const distBetweenEntryExit = turf.distance(entryPointOnLine, exitPointOnLine, { units: 'kilometers' });

            if (distBetweenEntryExit > 0.01) {
                // A. Check Progress
                const distToDestViaExit = turf.distance(exitPointOnLine, endPoint, { units: 'kilometers' });
                const distToDestViaEntry = turf.distance(entryPointOnLine, endPoint, { units: 'kilometers' });
                const threshold = distToDestViaEntry * (1.0 - MIN_PROGRESS_RATIO);
                const makesProgress = distToDestViaExit < threshold;

                // B. Check Bearing (Conditional)
                let bearingDifference = 0; // Declare outside the if
                let correctBearing = true; // Default true, only check non-rail/non-P2P
                if (!isRail && !isP2P) {
                    bearingDifference = 180; // Initialize specific value for check
                    try {
                        const entryLocation = entryPointOnLine.properties.location; // Location property only exists for non-P2P nearestPointOnLine result
                        const pointSlightlyAfterEntry = turf.along(line, entryLocation + 0.01, { units: 'kilometers' });
                        if (turf.distance(entryPointOnLine, pointSlightlyAfterEntry, { units: 'meters' }) > 1) {
                            const bearingToDest = turf.bearing(entryPointOnLine, endPoint);
                            const lineBearing = turf.bearing(entryPointOnLine, pointSlightlyAfterEntry);
                            bearingDifference = Math.abs(bearingToDest - lineBearing);
                            if (bearingDifference > 180) { bearingDifference = 360 - bearingDifference; }
                            correctBearing = bearingDifference <= MAX_BEARING_DIFFERENCE_DEGREES;
                        } else {
                             const pointSlightlyBeforeEntry = turf.along(line, entryLocation - 0.01, { units: 'kilometers' });
                             if (turf.distance(pointSlightlyBeforeEntry, entryPointOnLine, { units: 'meters' }) > 1) {
                                 const bearingToDest = turf.bearing(entryPointOnLine, endPoint);
                                 const lineBearing = turf.bearing(pointSlightlyBeforeEntry, entryPointOnLine);
                                 bearingDifference = Math.abs(bearingToDest - lineBearing);
                                 if (bearingDifference > 180) { bearingDifference = 360 - bearingDifference; }
                                 correctBearing = bearingDifference <= MAX_BEARING_DIFFERENCE_DEGREES;
                             } else { correctBearing = false; }
                        }
                    } catch (bearingError) { console.warn(`    -> Error calculating bearing...`); correctBearing = false; }
                }

                // C. Check Location Order (Only for non-P2P, non-Rail one-way modes)
                const isStrictlyOneWay = ['Bus', 'Jeep'].includes(line.properties.type);
                // Location check is only relevant if NOT P2P and NOT Rail
                const locationCheckPassed = isP2P || isRail || !isStrictlyOneWay || (exitPointOnLine.properties.location > entryPointOnLine.properties.location);

                console.log(`    -> Checking Line: ${line.properties.name} (${line.properties.type})`);
                console.log(`       Progress Check: ${makesProgress}`);
                if (!isRail && !isP2P) console.log(`       Bearing Check: ${correctBearing} (Diff: ${bearingDifference.toFixed(1)} <= ${MAX_BEARING_DIFFERENCE_DEGREES})`); else console.log(`       Bearing Check: SKIPPED (Rail/P2P)`);
                if (isStrictlyOneWay) console.log(`       Location Check: ${locationCheckPassed}`); else console.log(`       Location Check: SKIPPED (Rail/P2P/Other)`);

                // ALL relevant checks must pass
                if (makesProgress && correctBearing && locationCheckPassed) {
                    let segmentOnLine, segmentDistanceKm;
                    if (isP2P) {
                        segmentOnLine = line;
                        segmentDistanceKm = turf.length(line, { units: 'kilometers' });
                    } else {
                        segmentOnLine = turf.lineSlice(entryPointOnLine, exitPointOnLine, line);
                        if (!segmentOnLine?.geometry?.coordinates || segmentOnLine.geometry.coordinates.length < 2) {
                             console.warn(`       -> lineSlice failed for ${line.properties.name}. Skipping.`); continue;
                        }
                        segmentDistanceKm = turf.length(segmentOnLine, { units: 'kilometers' });
                    }
                    if (!bestLineOption || segmentDistanceKm < bestLineOption.distanceKm) {
                         bestLineOption = { line, entryPointOnLine, exitPointOnLine, distanceKm: segmentDistanceKm, isP2P: isP2P };
                         console.log(`       -> Candidate selected (provisional): ${line.properties.name}, On-line Dist: ${segmentDistanceKm.toFixed(2)}km`);
                    }
                } else { console.log(`    -> FAILED combined direction/progress/location check.`); }
            }
            // --- End ENHANCED Check ---

        } catch(lineError) { console.error(`Error processing candidate line ${line?.properties?.name}:`, lineError); }
    } // End loop

    // 3. Create Transit Segment if a line was selected
    if (bestLineOption) {
        const { line, entryPointOnLine, exitPointOnLine, distanceKm, isP2P } = bestLineOption;
        console.log(` -> Selected transit leg: ${line.properties.name} (${line.properties.type})`);
        const transitDist = distanceKm * 1000;
        const mode = line.properties.type;
        const transitTime = estimateSegmentDuration(mode, transitDist, false, false);
        const transitFare = calculateFare(mode, transitDist);
        const transitSegmentGeometry = isP2P ? line : turf.lineSlice(entryPointOnLine, exitPointOnLine, line);
        if (!transitSegmentGeometry?.geometry?.coordinates || transitSegmentGeometry.geometry.coordinates.length < 2) {
             console.error(` -> Failed to get geometry for selected transit leg: ${line.properties.name}. Discarding option.`); return null;
        }
        accumulatedSegments.push({ mode: mode, label: `Take ${line.properties.name || mode}`, distance: transitDist, duration: transitTime, fare: transitFare, geometry: transitSegmentGeometry.geometry });
        let exitPosition = isP2P ? turf.point(line.geometry.coordinates[line.geometry.coordinates.length - 1]) : turf.point(exitPointOnLine.geometry.coordinates);
        if (!isP2P && allowedStopTypes.length > 0) {
            const nearestEndStopInfo = findNearestStop(exitPosition, transitFeatures, allowedStopTypes);
            if (nearestEndStopInfo && nearestEndStopInfo.feature && nearestEndStopInfo.distance <= MAX_WALK_TO_TRANSIT_KM / 2) {
                 console.log(` -> Exiting near stop: ${nearestEndStopInfo.feature.properties.name}`);
                 exitPosition = turf.point(nearestEndStopInfo.feature.geometry.coordinates);
            } else { console.log(` -> No specific stop found very near exit point on line.`); }
        } else if (isP2P) { console.log(` -> Exiting at P2P terminal.`); }
        else { console.log(` -> No specific stops for mode ${mode}. Using line exit point.`); }
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
            const finalWalkGeometry = turf.lineString([currentPosition.geometry.coordinates, endPoint.geometry.coordinates]);
            accumulatedSegments.push({ mode: 'Walk', label: `Walk to Destination`, distance: walkFromStopDist, duration: walkFromStopTime, fare: 0, geometry: finalWalkGeometry.geometry });
        } else {
            console.log(` -> EXITED: Final walk (${(walkFromStopDist / 1000).toFixed(2)} km) is too long. Discarding ${primaryModeLabel} option.`); return null;
        }
    } else {
        console.log(` -> EXITED: Cannot add final walk as no transit leg was added.`); return null;
    }


    // 5. Assemble Combined Geometry (Simpler Concatenation)
    console.log(" -> Assembling combined geometry...");
    let combinedCoordinates = [];
    if (Array.isArray(accumulatedSegments) && accumulatedSegments.length > 0) {
        console.log(`   - Processing ${accumulatedSegments.length} segments for geometry combination.`);
        accumulatedSegments.forEach((seg, index) => {
            if (!seg?.geometry?.coordinates || !Array.isArray(seg.geometry.coordinates) || seg.geometry.coordinates.length === 0) {
                console.warn(`   - Segment ${index} (${seg?.mode}) has invalid or missing geometry. Skipping.`); return;
            }
            combinedCoordinates.push(...seg.geometry.coordinates);
        });
        if (combinedCoordinates.length > 1) {
            let originalLength = combinedCoordinates.length;
            let cleanedCoordinates = [combinedCoordinates[0]];
            for (let i = 1; i < combinedCoordinates.length; i++) {
                if (combinedCoordinates[i][0] !== cleanedCoordinates[cleanedCoordinates.length - 1][0] ||
                    combinedCoordinates[i][1] !== cleanedCoordinates[cleanedCoordinates.length - 1][1]) {
                    cleanedCoordinates.push(combinedCoordinates[i]);
                }
            }
            combinedCoordinates = cleanedCoordinates;
            console.log(`   - Cleaned duplicates: ${originalLength} -> ${cleanedCoordinates.length} points.`);
        }
    }
    console.log(` -> Total final combined coordinates: ${combinedCoordinates.length}`);
    const finalRouteGeometry = combinedCoordinates.length >= 2 ? turf.lineString(combinedCoordinates).geometry : null;
    if (!finalRouteGeometry) { console.warn(` -> Could not generate valid combined geometry for ${primaryModeLabel}.`); }
    else { console.log(` -> Successfully generated combined geometry.`); }

    // 6. Assemble final route object
    const totalDuration = accumulatedSegments.reduce((sum, s) => sum + (s?.duration || 0), 0);
    const totalDistance = accumulatedSegments.reduce((sum, s) => sum + (s?.distance || 0), 0);
    const totalFare = accumulatedSegments.reduce((sum, s) => sum + (s?.fare || 0), 0);
    return {
        type: "Feature",
        properties: {
            label: `Route via ${primaryModeLabel} (Est. ${(totalDuration / 60).toFixed(0)} min, P${totalFare.toFixed(2)})`,
            segments: accumulatedSegments,
            summary_duration: totalDuration,
            summary_distance: totalDistance,
            total_fare: totalFare,
            primary_mode: primaryModeLabel
        },
        geometry: finalRouteGeometry
    };
} // End tryBuildTransitRoute


// --- Helper Function: buildDirectRouteOption (CORRECTED) ---
function buildDirectRouteOption(awsRouteData, startPoint, endPoint) {
     if (!awsRouteData?.Summary || !awsRouteData?.Legs?.[0]?.Geometry?.LineString) { console.error("buildDirectRouteOption: Invalid AWS route data."); return null; }
     const awsRouteGeometry = awsRouteData.Legs[0].Geometry.LineString;
     if (!Array.isArray(awsRouteGeometry) || awsRouteGeometry.length < 2) { console.error("buildDirectRouteOption: Invalid AWS route geometry."); return null; }
     const awsRouteLine = turf.lineString(awsRouteGeometry);
     const totalAwsDistanceMeters = turf.length(awsRouteLine, { units: 'meters' });
     const directSegments = [ { mode: 'Driving', label: 'Direct Route', distance: totalAwsDistanceMeters, duration: awsRouteData.Summary.DurationSeconds, fare: 0, geometry: awsRouteLine.geometry } ];
     return { type: "Feature", properties: { label: `Direct Route (AWS Est: ${(awsRouteData.Summary.DurationSeconds / 60).toFixed(0)} min)`, segments: directSegments, summary_duration: awsRouteData.Summary.DurationSeconds, summary_distance: totalAwsDistanceMeters, total_fare: 0, primary_mode: 'Driving' }, geometry: awsRouteLine.geometry };
}


// --- Main Exported Function ---
export function buildSnappedRouteData(awsRouteData, transitFeatures) {
    console.log("Starting buildSnappedRouteData - Generating multiple options...");
    let finalRouteOptions = [];

    // Validate essential inputs early
    if (!awsRouteData?.Legs?.[0]?.Geometry?.LineString || !Array.isArray(transitFeatures)) { console.error("buildSnappedRouteData: Missing AWS geometry or transitFeatures."); return []; }
    const awsRouteGeometry = awsRouteData.Legs[0].Geometry.LineString;
    if (!Array.isArray(awsRouteGeometry) || awsRouteGeometry.length < 2) { console.error("buildSnappedRouteData: Invalid AWS route geometry."); return []; }
    const startPoint = turf.point(awsRouteGeometry[0]);
    const endPoint = turf.point(awsRouteGeometry[awsRouteGeometry.length - 1]);

    // --- Attempt to build route for each prioritized mode group ---
    const modesToTry = [
        { types: ['MRT'], label: 'MRT' },
        { types: ['LRT1'], label: 'LRT1' },
        { types: ['LRT2'], label: 'LRT2' },
        { types: ['Bus', 'P2P-Bus'], label: 'Bus' }, // P2P handled inside tryBuildTransitRoute
        { types: ['Jeep'], label: 'Jeep' }
    ];

    modesToTry.forEach(modeGroup => {
        try {
            const option = tryBuildTransitRoute(startPoint, endPoint, transitFeatures, modeGroup.types, modeGroup.label);
            if (option) { finalRouteOptions.push(option); }
        } catch (error) { console.error(`Error generating route option for mode ${modeGroup.label}:`, error); }
    });

    // --- Always Add Direct Driving Route ---
    try {
        const directOption = buildDirectRouteOption(awsRouteData, startPoint, endPoint);
        if (directOption) { finalRouteOptions.push(directOption); }
        else { console.warn("Could not generate Direct Route option."); }
    } catch(error) { console.error("Error building direct route option:", error); }

    // --- Refine/Filter Results (Keep ALL unique options) ---
    const uniqueOptions = [...finalRouteOptions]; // Keep all generated options initially

    // Sort options: Prioritize lower duration, then lower fare
    uniqueOptions.sort((a, b) => {
        const durationA = a?.properties?.summary_duration ?? Infinity;
        const durationB = b?.properties?.summary_duration ?? Infinity;
        if (durationA !== durationB) { return durationA - durationB; }
        const fareA = a?.properties?.total_fare ?? Infinity;
        const fareB = b?.properties?.total_fare ?? Infinity;
        return fareA - fareB;
    });

    console.log(`buildSnappedRouteData finished. Returning ${uniqueOptions.length} options (including potential duplicates):`, uniqueOptions.map(o=>o?.properties?.label || 'Invalid Label'));
    return uniqueOptions; // Return ALL generated options, sorted
}
