import * as turf from "@turf/turf";
import AWS from 'aws-sdk';
import { awsConfig } from "../config/config";

// --- Constants for Logic ---
const MAX_WALK_TO_TRANSIT_KM = 1.5;
const MAX_DISTANCE_FROM_STOP_TO_LINE_KM = 0.1;
const MIN_PROGRESS_RATIO = 0.1;
const MAX_BEARING_DIFFERENCE_DEGREES = 80;

// --- Speed Constants (Kilometers per Hour - KPH) ---
const AVG_JEEP_SPEED_KPH = 20.0;
const AVG_BUS_SPEED_KPH = 30.0;
const AVG_P2P_BUS_SPEED_KPH = 36.0;
const AVG_LRT_SPEED_KPH = 60.0;
const AVG_MRT_SPEED_KPH = 45.0;

// Define Estimated Wait/Transfer Times (SECONDS)
const ESTIMATED_TRANSIT_WAIT_TIME_SEC = 300;

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
        return Math.round(baseFare * 4) / 4;
    } else {
        const extraKm = distanceKm - baseKm;
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
    const baseFare = 16.25;
    const additionalPerKm = 1.47;
    if (distanceKm <= 0) return 0;
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
    if (distanceKm <= 3) return 13;
    if (distanceKm <= 6) return 16;
    if (distanceKm <= 10) return 20;
    if (distanceKm <= 14) return 24;
    return 28;
}

/**
 * Main fare calculation dispatcher.
 * @param {string} mode - The mode of transport.
 * @param {number} distanceMeters - Distance in meters.
 * @returns {number} Calculated fare in pesos.
 */
function calculateFare(mode, distanceMeters) {
    const distanceKm = distanceMeters / 1000;
    if (mode === 'P2P-Bus') { return 150; }
    switch (mode) {
        case 'Jeep': return calculateJeepFare(distanceKm);
        case 'Bus': return calculateBusFare(distanceKm);
        case 'MRT': return calculateMRTFare(distanceKm);
        case 'LRT1': case 'LRT2': return calculateLRTFare(distanceKm);
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
  if (!targetPoint || typeof targetPoint !== 'object' || !Array.isArray(transitFeatures) || !Array.isArray(allowedTypes)) {
    console.error("findNearestStop: Invalid input.", { targetPoint: JSON.stringify(targetPoint), allowedTypes });
    return { feature: null, distance: Infinity };
  }
  try {
    transitFeatures.forEach((feature) => {
      try {
        if (feature?.geometry?.type === 'Point' && feature?.properties?.type && allowedTypes.includes(feature.properties.type)) {
          const coords = feature.geometry.coordinates;
          if (!Array.isArray(coords) || coords.length < 2 || typeof coords[0] !== 'number' || typeof coords[1] !== 'number' || isNaN(coords[0]) || isNaN(coords[1])) return;
          const stopPoint = turf.point(coords);
          const distance = turf.distance(targetPoint, stopPoint, { units: 'kilometers' });
          if (typeof distance === 'number' && !isNaN(distance) && distance < minDistance) {
            minDistance = distance; nearestFeature = feature;
          }
        }
      } catch (innerError) { console.error(`findNearestStop: Error processing feature...`, innerError); }
    });
  } catch (outerError) { console.error("findNearestStop: Outer error.", outerError); return { feature: null, distance: Infinity }; }
  return { feature: nearestFeature, distance: minDistance };
}


// --- Helper Function: Estimate Segment Duration (Using KPH) ---
/**
 * Estimates duration for a TRANSIT route segment based on mode and distance.
 * Uses KPH constants and returns total time in SECONDS.
 * NOTE: This is NOT used for AWS calculated walking segments.
 */
function estimateSegmentDuration(mode, distanceMeters) {
  let speedKph;
  const distanceKm = distanceMeters / 1000;
  const cleanMode = mode?.replace('-Stop', '') || 'Walk';
  switch (cleanMode) {
    case 'Jeep': speedKph = AVG_JEEP_SPEED_KPH; break;
    case 'Bus': speedKph = AVG_BUS_SPEED_KPH; break;
    case 'P2P-Bus': speedKph = AVG_P2P_BUS_SPEED_KPH; break;
    case 'LRT1': case 'LRT2': speedKph = AVG_LRT_SPEED_KPH; break;
    case 'MRT': speedKph = AVG_MRT_SPEED_KPH; break;
    default: console.warn(`Estimating transit duration for unknown mode "${mode}"...`); return ESTIMATED_TRANSIT_WAIT_TIME_SEC;
  }
  let travelTimeSec = 0;
  if (distanceKm > 0 && speedKph && speedKph > 0) {
      const travelTimeHours = distanceKm / speedKph;
      travelTimeSec = travelTimeHours * 3600;
  } else if (distanceKm > 0) { console.warn(`Invalid speed (${speedKph}) for mode ${mode}...`); travelTimeSec = 0; }
  return travelTimeSec + ESTIMATED_TRANSIT_WAIT_TIME_SEC;
}


// --- Helper Function: tryBuildTransitRoute (ASYNC with AWS WALKING, P2P, CONDITIONAL DIRECTION, FULL STOP SEQUENCE) ---
/**
 * Attempts to build a single transit route option focusing on specific modes.
 * Uses AWS calculateRoute for walking segments. Includes boarding/alighting stops in labels
 * and attempts to extract intermediate stops.
 * Returns a route object if successful, null otherwise.
 */
async function tryBuildTransitRoute(startPoint, endPoint, transitFeatures, allowedLineTypes, primaryModeLabel, routeCalculator) {
    console.log(`Attempting to build route prioritizing: ${allowedLineTypes.join(', ')}`);

    try {
        console.log(` -> Start Point Coords: ${JSON.stringify(startPoint?.geometry?.coordinates)}`);
        console.log(` -> End Point Coords: ${JSON.stringify(endPoint?.geometry?.coordinates)}`);
    } catch (e) { console.error("Error logging points:", e)}

    let currentPosition = startPoint;
    let accumulatedSegments = [];
    let transitLegAdded = false;
    let boardingStopName = 'Origin Area';
    let alightingStopName = 'Destination Area';
    let startStopPoint = null;
    let nearestStartStopFeature = null;
    let nearestEndStopFeature = null;

    const allowedStopTypes = allowedLineTypes.flatMap(type => {
        if (['MRT', 'LRT1', 'LRT2', 'Bus', 'P2P-Bus'].includes(type)) { return [`${type}-Stop`, 'Bus-Stop']; }
        return [];
      }).filter((v, i, a) => a.indexOf(v) === i);
    if (allowedLineTypes.includes('Bus') && !allowedStopTypes.includes('Bus-Stop')) { allowedStopTypes.push('Bus-Stop'); }
    const requiresStartStop = !(allowedLineTypes.includes('Jeep') && allowedStopTypes.length === 0);
    console.log(` -> Requires Start Stop: ${requiresStartStop}, Allowed Stop Types: [${allowedStopTypes.join(', ')}]`);
    if (allowedStopTypes.length === 0 && !allowedLineTypes.includes('Jeep')) {
        console.log(` -> EXITED EARLY: No stop types defined for allowed lines: [${allowedLineTypes.join(', ')}].`);
        return null;
    }

    if (requiresStartStop) {
        console.log(` -> Calling findNearestStop for types [${allowedStopTypes.join(', ')}] near ${JSON.stringify(startPoint?.geometry?.coordinates)}`);
        const nearestStartStopInfo = findNearestStop(startPoint, transitFeatures, allowedStopTypes);
        console.log(` -> findNearestStop Result: ${JSON.stringify(nearestStartStopInfo)}`);

        if (nearestStartStopInfo?.feature && nearestStartStopInfo.distance <= MAX_WALK_TO_TRANSIT_KM) {
            nearestStartStopFeature = nearestStartStopInfo.feature;
            boardingStopName = nearestStartStopFeature.properties.name || `Stop near Origin`;
            startStopPoint = turf.point(nearestStartStopFeature.geometry.coordinates);
            console.log(` -> Found nearby start stop: ${boardingStopName} (${nearestStartStopFeature.properties.type})`);

            try {
                const walkParams1 = {
                    CalculatorName: awsConfig.routeCalculatorName,
                    DeparturePosition: startPoint.geometry.coordinates,
                    DestinationPosition: startStopPoint.geometry.coordinates,
                    TravelMode: 'Walking', IncludeLegGeometry: true
                };
                console.log("   - Calculating walk route 1 (Origin -> Stop)...");
                const walkRoute1Data = await routeCalculator.calculateRoute(walkParams1).promise();

                if (walkRoute1Data?.Legs?.[0]) {
                    const leg = walkRoute1Data.Legs[0];
                    if (leg.Distance > MAX_WALK_TO_TRANSIT_KM * 1.1) {
                        console.warn(`   -> AWS Walk 1 distance (${leg.Distance.toFixed(2)}km) exceeds limit. Discarding.`); return null;
                    }
                    accumulatedSegments.push({
                        mode: 'Walk', label: `Walk to ${boardingStopName}`,
                        distance: leg.Distance * 1000, duration: leg.DurationSeconds, fare: 0,
                        geometry: { type: 'LineString', coordinates: leg.Geometry.LineString }
                    });
                    currentPosition = startStopPoint;
                    console.log("   - Added Walk Route 1 Segment (AWS)");
                } else { throw new Error("No walking leg found from AWS"); }
            } catch (walkError1) {
                console.error("   - Failed to calculate walk route 1:", walkError1.message); return null;
            }
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

    let bestLineOption = null;
    const candidateLines = transitFeatures.filter(f => f?.geometry?.type === 'LineString' && f?.properties?.type && allowedLineTypes.includes(f.properties.type));
    console.log(` -> Checking ${candidateLines.length} candidate lines...`);
    for (const line of candidateLines) {
        try {
            const isP2P = line.properties.type === 'P2P-Bus';
            const isRail = ['MRT', 'LRT1', 'LRT2'].includes(line.properties.type);
            let entryPointOnLine, exitPointOnLine;

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

            const distBetweenEntryExit = turf.distance(entryPointOnLine, exitPointOnLine, { units: 'kilometers' });
            if (distBetweenEntryExit > 0.01) {
                const distToDestViaExit = turf.distance(exitPointOnLine, endPoint, { units: 'kilometers' });
                const distToDestViaEntry = turf.distance(entryPointOnLine, endPoint, { units: 'kilometers' });
                const threshold = distToDestViaEntry * (1.0 - MIN_PROGRESS_RATIO);
                const makesProgress = distToDestViaExit < threshold;
                let bearingDifference = 0;
                let correctBearing = true;
                if (!isRail && !isP2P) {
                    bearingDifference = 180;
                    try {
                        const entryLocation = entryPointOnLine.properties.location;
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
                    } catch (bearingError) { console.warn(`     -> Error calculating bearing...`); correctBearing = false; }
                }
                const isStrictlyOneWay = ['Bus', 'Jeep'].includes(line.properties.type);
                const locationCheckPassed = isP2P || isRail || !isStrictlyOneWay || (exitPointOnLine?.properties?.location > entryPointOnLine?.properties?.location);

                if (makesProgress && correctBearing && locationCheckPassed) {
                    let segmentOnLine, segmentDistanceKm;
                    if (isP2P) {
                        segmentOnLine = line; segmentDistanceKm = turf.length(line, { units: 'kilometers' });
                    } else {
                        segmentOnLine = turf.lineSlice(entryPointOnLine, exitPointOnLine, line);
                        if (!segmentOnLine?.geometry?.coordinates || segmentOnLine.geometry.coordinates.length < 2) { continue; }
                        segmentDistanceKm = turf.length(segmentOnLine, { units: 'kilometers' });
                    }
                    if (!bestLineOption || segmentDistanceKm < bestLineOption.distanceKm) {
                        bestLineOption = { line, entryPointOnLine, exitPointOnLine, distanceKm: segmentDistanceKm, isP2P: isP2P };
                        console.log(`         -> Candidate selected (provisional): ${line.properties.name}, On-line Dist: ${segmentDistanceKm.toFixed(2)}km`);
                    }
                }
            }
        } catch(lineError) { console.error(`Error processing candidate line ${line?.properties?.name}:`, lineError); }
    } // End loop

    if (bestLineOption) {
        const { line, entryPointOnLine, exitPointOnLine, distanceKm, isP2P } = bestLineOption;
        const mode = line.properties.type;
        const lineName = line.properties.name || mode;
        nearestEndStopFeature = null;

        let exitPosition = isP2P ? turf.point(line.geometry.coordinates[line.geometry.coordinates.length - 1]) : turf.point(exitPointOnLine.geometry.coordinates);
        alightingStopName = 'Destination Area';

        if (!isP2P && allowedStopTypes.length > 0) {
            const nearestEndStopInfo = findNearestStop(exitPosition, transitFeatures, allowedStopTypes);
            if (nearestEndStopInfo?.feature && nearestEndStopInfo.distance <= MAX_WALK_TO_TRANSIT_KM / 2) {
                nearestEndStopFeature = nearestEndStopInfo.feature;
                alightingStopName = nearestEndStopFeature.properties.name || `Stop near Destination`;
                exitPosition = turf.point(nearestEndStopFeature.geometry.coordinates);
            } else { alightingStopName = `Area near Destination`; }
        } else if (isP2P) {
            alightingStopName = line.properties.name ? `${line.properties.name} Terminal` : `P2P Terminal`;
            nearestEndStopFeature = transitFeatures.find(f => f.properties.name === line.properties.stops?.[line.properties.stops.length -1] && f.geometry.type === 'Point');
            if(nearestEndStopFeature) alightingStopName = nearestEndStopFeature.properties.name;
        } else { alightingStopName = `Area near Destination`; }

        console.log(` -> Selected transit leg: ${lineName} (${mode})`);
        const transitDist = distanceKm * 1000;
        const transitTime = estimateSegmentDuration(mode, transitDist);
        const transitFare = calculateFare(mode, transitDist);
        const transitSegmentGeometryFeature = isP2P ? line : turf.lineSlice(entryPointOnLine, exitPointOnLine, line);
        if (!transitSegmentGeometryFeature?.geometry?.coordinates) { return null; }

        let fullStopSequence = [];
        const lineStopsSequence = line.properties?.stops;
        const finalBoardingStopName = nearestStartStopFeature?.properties?.name || boardingStopName;
        const finalAlightingStopName = nearestEndStopFeature?.properties?.name || alightingStopName;

        if (Array.isArray(lineStopsSequence) && lineStopsSequence.length > 0) {
            const boardIdx = lineStopsSequence.findIndex(stopName => stopName === finalBoardingStopName);
            const alightIdx = lineStopsSequence.findIndex(stopName => stopName === finalAlightingStopName);
            console.log(`   - Stop Sequence Check: Board='${finalBoardingStopName}' (idx ${boardIdx}), Alight='${finalAlightingStopName}' (idx ${alightIdx})`);
            if (boardIdx !== -1 && alightIdx !== -1) {
                if (boardIdx <= alightIdx) {
                    fullStopSequence = lineStopsSequence.slice(boardIdx, alightIdx + 1);
                } else {
                    fullStopSequence = lineStopsSequence.slice(alightIdx, boardIdx + 1).reverse();
                }
                console.log(`   - Full Stop Sequence Found: [${fullStopSequence.join(', ')}]`);
            } else { console.warn(`   - Could not find boarding/alighting stops in sequence.`); }
        } else { console.warn(`   - No 'stops' array found in properties for line: ${lineName}`); }

        accumulatedSegments.push({
            mode: mode, label: `Take ${lineName} from ${finalBoardingStopName} to ${finalAlightingStopName}`,
            distance: transitDist, duration: transitTime, fare: transitFare,
            geometry: transitSegmentGeometryFeature.geometry,
            fullStopSequence: fullStopSequence
        });

        currentPosition = exitPosition;
        transitLegAdded = true;
    } else { console.log(` -> EXITED: No suitable line found for mode(s): [${allowedLineTypes.join(', ')}]`); return null; }

    if (transitLegAdded) {
        try {
            const walkParams2 = { CalculatorName: awsConfig.routeCalculatorName, DeparturePosition: currentPosition.geometry.coordinates, DestinationPosition: endPoint.geometry.coordinates, TravelMode: 'Walking', IncludeLegGeometry: true };
            console.log("   - Calculating walk route 2 (Exit -> Destination)...");
            const walkRoute2Data = await routeCalculator.calculateRoute(walkParams2).promise();
            if (walkRoute2Data?.Legs?.[0]) {
                const leg = walkRoute2Data.Legs[0];
                if ((leg.Distance) <= MAX_WALK_TO_TRANSIT_KM * 1.5) {
                    accumulatedSegments.push({
                        mode: 'Walk', label: `Walk from ${alightingStopName} to Destination`,
                        distance: leg.Distance * 1000, duration: leg.DurationSeconds, fare: 0,
                        geometry: { type: 'LineString', coordinates: leg.Geometry.LineString }
                    });
                    console.log("   - Added Walk Route 2 Segment (AWS)");
                } else { console.log(` -> EXITED: Final walk (AWS: ${leg.Distance.toFixed(2)} km) is too long.`); return null; }
            } else { throw new Error("No walking leg found from AWS"); }
        } catch (walkError2) { console.error("   - Failed to calculate walk route 2:", walkError2.message); return null; }
    } else { console.log(` -> EXITED: Cannot add final walk.`); return null; }

    console.log(" -> Assembling combined geometry...");
    let combinedCoordinates = [];
    if (Array.isArray(accumulatedSegments) && accumulatedSegments.length > 0) {
        accumulatedSegments.forEach((seg) => {
            if (seg?.geometry?.coordinates && Array.isArray(seg.geometry.coordinates)) { combinedCoordinates.push(...seg.geometry.coordinates); }
        });
        if (combinedCoordinates.length > 1) {
            let cleaned = [combinedCoordinates[0]];
            for (let i = 1; i < combinedCoordinates.length; i++) { if (combinedCoordinates[i][0] !== cleaned[cleaned.length - 1][0] || combinedCoordinates[i][1] !== cleaned[cleaned.length - 1][1]) { cleaned.push(combinedCoordinates[i]); } }
            combinedCoordinates = cleaned;
        }
    }
    const finalRouteGeometry = combinedCoordinates.length >= 2 ? turf.lineString(combinedCoordinates).geometry : null;
    if (finalRouteGeometry) console.log(` -> Successfully generated combined geometry.`);
    else console.warn(` -> Could not generate valid combined geometry for ${primaryModeLabel}.`);

    const totalDuration = accumulatedSegments.reduce((sum, s) => sum + (s?.duration || 0), 0);
    const totalDistance = accumulatedSegments.reduce((sum, s) => sum + (s?.distance || 0), 0);
    const totalFare = accumulatedSegments.reduce((sum, s) => sum + (s?.fare || 0), 0);
    return {
        type: "Feature",
        properties: {
            label: `Route via ${primaryModeLabel} (Est. ${(totalDuration / 60).toFixed(0)} min, P${totalFare.toFixed(2)})`,
            segments: accumulatedSegments,
            summary_duration: totalDuration, summary_distance: totalDistance,
            total_fare: totalFare, primary_mode: primaryModeLabel
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


// --- Main Exported Function (ASYNC) ---
export async function buildSnappedRouteData(awsRouteData, transitFeatures) {
    console.log("Starting buildSnappedRouteData - Generating multiple options...");
    let finalRouteOptions = [];

    if (!awsRouteData?.Legs?.[0]?.Geometry?.LineString || !Array.isArray(transitFeatures)) { console.error("buildSnappedRouteData: Missing AWS geometry or transitFeatures."); return []; }
    const awsRouteGeometry = awsRouteData.Legs[0].Geometry.LineString;
    if (!Array.isArray(awsRouteGeometry) || awsRouteGeometry.length < 2) { console.error("buildSnappedRouteData: Invalid AWS route geometry."); return []; }
    const startPoint = turf.point(awsRouteGeometry[0]);
    const endPoint = turf.point(awsRouteGeometry[awsRouteGeometry.length - 1]);

    if (!AWS.config.credentials) {
        console.error("AWS Credentials not configured. Cannot create route calculator.");
        const directOption = buildDirectRouteOption(awsRouteData, startPoint, endPoint);
        return directOption ? [directOption] : [];
    }
    const routeCalculator = new AWS.Location();

    const modesToTry = [
        { types: ['MRT'], label: 'MRT' },
        { types: ['LRT1'], label: 'LRT1' },
        { types: ['LRT2'], label: 'LRT2' },
        { types: ['Bus', 'P2P-Bus'], label: 'Bus' },
        { types: ['Jeep'], label: 'Jeep' }
    ];

    const transitPromises = modesToTry.map(modeGroup =>
        tryBuildTransitRoute(startPoint, endPoint, transitFeatures, modeGroup.types, modeGroup.label, routeCalculator)
            .catch(error => {
                console.error(`Error generating route option for mode ${modeGroup.label}:`, error); return null;
            })
    );
    const transitResults = await Promise.allSettled(transitPromises);
    transitResults.forEach(result => {
        if (result.status === 'fulfilled' && result.value) { finalRouteOptions.push(result.value); }
        else if (result.status === 'rejected') { console.error("A transit route promise was rejected:", result.reason); }
    });

    try {
        const directOption = buildDirectRouteOption(awsRouteData, startPoint, endPoint);
        if (directOption) { finalRouteOptions.push(directOption); }
        else { console.warn("Could not generate Direct Route option."); }
    } catch(error) { console.error("Error building direct route option:", error); }

    const uniqueOptions = [...finalRouteOptions];

    uniqueOptions.sort((a, b) => {
        const durationA = a?.properties?.summary_duration ?? Infinity;
        const durationB = b?.properties?.summary_duration ?? Infinity;
        if (durationA !== durationB) { return durationA - durationB; }
        const fareA = a?.properties?.total_fare ?? Infinity;
        const fareB = b?.properties?.total_fare ?? Infinity;
        return fareA - fareB;
    });

    console.log(`buildSnappedRouteData finished. Returning ${uniqueOptions.length} options (including potential duplicates):`, uniqueOptions.map(o=>o?.properties?.label || 'Invalid Label'));
    return uniqueOptions;
}