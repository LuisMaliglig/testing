import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// Removed AWS import as it's not directly used here anymore, only config is needed
// import AWS from "aws-sdk";
import { awsConfig } from "../config/config"; // Ensure path is correct
import logo from "../assets/logo.png"; // Ensure path is correct
import * as turf from "@turf/turf"; // Import turf for bounding box calculation

// --- Mode Colors and Icons ---
const modeColors = {
    MRT: "#facc15", // Yellow-400
    LRT: "#22c55e", // Green-500
    Jeep: "#FFA500", // Orange
    "P2P-Bus": "#f97316", // Orange-500
    Bus: "#3b82f6", // Blue-500
    Walk: "#9ca3af", // Gray-400 (for dashed line)
    Driving: "#6b7280", // Gray-500
    // Add other potential modes if needed
};

const getModeIcon = (mode = 'Unknown') => { // Added default value
    switch (mode) {
        case 'MRT': return 'train';
        case 'LRT': return 'tram';
        case 'Bus':
        case 'P2P-Bus': return 'directions_bus';
        case 'Jeep': return 'airport_shuttle'; // Placeholder
        case 'Walk': return 'directions_walk';
        case 'Driving': return 'directions_car';
        default: return 'route';
    }
};

// --- Component ---
const RouteBreakdown = () => {
    const mapContainerRef = useRef(null);
    const mapRef = useRef(null);
    const navigate = useNavigate();
    const location = useLocation();

    // Extract state from navigation, provide robust defaults
    const {
        origin = 'Unknown Origin',
        destination = 'Unknown Destination',
        suggestedRoutes = [], // Default to empty array
        selectedRouteIndex = 0,
        awsRouteData = null, // Keep AWS data if needed for driving steps
    } = location.state || {};

    // --- State ---
    const [currentlySelectedIdx, setCurrentlySelectedIdx] = useState(() => {
        // Ensure initial index is valid
        if (suggestedRoutes && suggestedRoutes.length > 0 && selectedRouteIndex >= 0 && selectedRouteIndex < suggestedRoutes.length) {
            return selectedRouteIndex;
        }
        return 0; // Default to 0 if initial index is invalid or no routes
    });
    const [currentSegments, setCurrentSegments] = useState([]); // Segments for timeline/list display
    const [currentSteps, setCurrentSteps] = useState([]); // AWS steps for driving
    const [currentRouteLabel, setCurrentRouteLabel] = useState("Loading...");
    const [currentRouteProps, setCurrentRouteProps] = useState(null); // Properties of selected route

    // --- Initialize Map ---
    useEffect(() => {
        // Add Material Icons font link if not present
        const iconsLink = document.getElementById('material-icons-link');
        if (!iconsLink) {
             const link = document.createElement('link');
             link.id = 'material-icons-link';
             link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
             link.rel = 'stylesheet';
             document.head.appendChild(link);
        }

        if (!mapContainerRef.current) return;
        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
            center: [121.0357, 14.4981], // Initial center
            zoom: 11,
        });
        mapRef.current = map;

        map.on('load', () => {
            if (!mapRef.current) return; // Check map still exists

            // --- Setup Source and Layers for Segments ---
            if (!mapRef.current.getSource('route-segments')) {
                mapRef.current.addSource('route-segments', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] } // Initialize empty
                });
                console.log("Map source 'route-segments' added.");
            } else {
                console.log("Map source 'route-segments' already exists.");
            }


            // Define layers for each mode type
            Object.keys(modeColors).forEach(mode => {
                const layerId = `route-segment-${mode}`;
                if (!mapRef.current.getLayer(layerId)) {
                    mapRef.current.addLayer({
                        id: layerId,
                        type: 'line',
                        source: 'route-segments',
                        filter: ['==', ['get', 'mode'], mode], // Filter features by mode property
                        layout: {
                            'line-join': 'round',
                            'line-cap': 'round'
                        },
                        paint: {
                            'line-color': modeColors[mode],
                            'line-width': mode === 'Walk' ? 4 : 6,
                            'line-opacity': 0.85,
                            ...(mode === 'Walk' && { 'line-dasharray': [2, 2] })
                        }
                    });
                    console.log(`Map layer '${layerId}' added.`);
                } else {
                     console.log(`Map layer '${layerId}' already exists.`);
                }
            });
            // --- End Layer Setup ---
        });

        map.on('error', (e) => console.error("MapLibre Error:", e));

        return () => {
            if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
        };
    }, []); // Run map initialization only once

    // --- Load/Update Route Details When Selection Changes ---
    useEffect(() => {
        // Basic validation
        if (!Array.isArray(suggestedRoutes) || suggestedRoutes.length === 0) {
            console.warn("No suggested routes available.");
            setCurrentSegments([]); setCurrentSteps([]); setCurrentRouteLabel("No routes found."); setCurrentRouteProps(null);
            if (mapRef.current?.getSource('route-segments')) { mapRef.current.getSource('route-segments').setData({ type: 'FeatureCollection', features: [] }); }
            return;
        }
        if (currentlySelectedIdx < 0 || currentlySelectedIdx >= suggestedRoutes.length) {
            console.warn(`Selected index ${currentlySelectedIdx} out of bounds. Resetting to 0.`);
            setCurrentlySelectedIdx(0); return;
        }
        const selectedRoute = suggestedRoutes[currentlySelectedIdx];
        if (!selectedRoute?.properties?.segments || !selectedRoute?.properties?.label) {
            console.error("Selected route object (index " + currentlySelectedIdx + ") is invalid.", selectedRoute);
            setCurrentSegments([]); setCurrentSteps([]); setCurrentRouteLabel("Invalid route data"); setCurrentRouteProps(null);
            if (mapRef.current?.getSource('route-segments')) { mapRef.current.getSource('route-segments').setData({ type: 'FeatureCollection', features: [] }); }
            return;
        }

        console.log(`Loading details for index ${currentlySelectedIdx}: ${selectedRoute.properties.label}`);
        setCurrentRouteLabel(selectedRoute.properties.label);
        setCurrentRouteProps(selectedRoute.properties);

        // 1. Update Segments state for UI
        const segmentsForUI = selectedRoute.properties.segments.filter(seg => seg && typeof seg.mode === 'string');
        setCurrentSegments(segmentsForUI);

        // 2. Update AWS Steps state
        if (selectedRoute.properties.primary_mode === 'Driving' && Array.isArray(awsRouteData?.Legs?.[0]?.Steps)) {
            setCurrentSteps(awsRouteData.Legs[0].Steps);
        } else {
            setCurrentSteps([]);
        }

        // --- 3. Update Map Data Source with Individual Segments ---
        const updateMapData = () => {
             if (!mapRef.current || !mapRef.current.isStyleLoaded()) {
                  console.log("Map style not ready for data update, will retry...");
                  // setTimeout(updateMapData, 300); // Consider removing retry or making it safer
                  return;
             }

             // Create a FeatureCollection from the segments array
             const segmentFeatures = selectedRoute.properties.segments
                 .map((seg, index) => {
                     // *** ADDED DEBUG LOG HERE ***
                     console.log(`Checking segment ${index} (mode: ${seg?.mode}):`, JSON.stringify(seg));
                     // ***************************

                     // Validate segment geometry before creating feature
                     if (seg?.geometry && seg.geometry.type === 'LineString' && Array.isArray(seg.geometry.coordinates) && seg.geometry.coordinates.length >= 2) {
                         return {
                             type: 'Feature',
                             geometry: seg.geometry,
                             properties: {
                                 mode: seg.mode || 'Unknown', // Ensure mode property exists for filtering
                                 label: seg.label,
                                 // Add any other properties needed for popups or interactions
                             }
                         };
                     } else {
                         console.warn(`Segment ${index} (mode: ${seg?.mode}) has invalid geometry. Skipping map feature.`);
                         return null; // Skip segments with invalid geometry
                     }
                 })
                 .filter(feature => feature !== null); // Remove null entries

             const routeSegmentsGeoJSON = {
                 type: 'FeatureCollection',
                 features: segmentFeatures
             };

             // Update the 'route-segments' source
             const source = mapRef.current.getSource('route-segments');
             if (source) {
                  source.setData(routeSegmentsGeoJSON);
                  console.log(` -> Updated map source 'route-segments' with ${segmentFeatures.length} segment features.`);
             } else {
                  console.error("Map source 'route-segments' not found!");
             }


             // Fit map to the bounds of the *entire original route geometry* if available,
             // otherwise fit to the bounds of the generated segments.
             let geometryForBounds = selectedRoute.geometry; // Prefer top-level combined geometry first
             if (!geometryForBounds && segmentFeatures.length > 0) {
                  try { geometryForBounds = turf.featureCollection(segmentFeatures); }
                  catch(e) { console.error("Error creating feature collection for bounds:", e); }
             }

             if (geometryForBounds) {
                 try {
                     const bounds = turf.bbox(geometryForBounds);
                     if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(n => typeof n === 'number' && !isNaN(n))) {
                         mapRef.current.fitBounds(bounds, {
                             padding: { top: 60, bottom: 60, left: 380, right: 60 },
                             maxZoom: 16,
                             duration: 500
                         });
                     } else { console.warn("Could not calculate valid bounds for route geometry:", bounds); }
                 } catch (e) { console.error("Error calculating or fitting bounds:", e); }
             } else {
                  console.warn(`No valid geometry found for route index ${currentlySelectedIdx} to calculate map bounds.`);
             }
        };

        // Call the map update function
        updateMapData();
        // --- End Map Update ---

    }, [currentlySelectedIdx, suggestedRoutes, awsRouteData]); // Dependencies

    // --- Calculate Display Values (same as before) ---
    const getCurrentTotalDurationMin = () => {
        const durationSec = currentRouteProps?.summary_duration;
        return typeof durationSec === 'number' && !isNaN(durationSec) ? (durationSec / 60).toFixed(0) : 'N/A';
    };
    const getCurrentTotalFare = () => {
        const fare = currentRouteProps?.total_fare;
        return typeof fare === 'number' && !isNaN(fare) ? `P${fare.toFixed(2)}` : '';
    };


    // --- JSX Return (Structure remains the same) ---
    return (
        <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif" }}>
            {/* Sidebar */}
            <div style={{
                position: "absolute", left: 0, top: 0, width: "350px", height: "100%",
                backdropFilter: "blur(5px)", backgroundColor: "rgba(0, 0, 0, 0.75)",
                zIndex: 10, display: "flex", flexDirection: "column",
                boxShadow: '3px 0px 10px rgba(0,0,0,0.3)'
            }}>
                {/* Sidebar Content */}
                <div style={{ color: "white", overflowY: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                   {/* Top Bar */}
                   <div style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                       <img src={logo} alt="Logo" style={{ width: "40px", height: "40px", cursor: "pointer" }} onClick={() => navigate("/")}/>
                       <button onClick={() => navigate("/nav-view")} style={{
                           padding: "8px 12px", backgroundColor: "#1e40af", color: "#fff",
                           border: "none", borderRadius: "5px", cursor: "pointer", fontFamily: "Montserrat, sans-serif", fontSize: '0.9rem'
                       }}>
                           Back to Options
                       </button>
                   </div>

                   {/* Scrollable Content Area */}
                   <div style={{ padding: "0 16px 16px 16px", overflowY: 'auto', flexGrow: 1 }}>
                       {/* Header */}
                       <h1 style={{ fontSize: "1.4rem", fontWeight: "bold", marginBottom: "8px" }}>Route Options</h1>
                       <p style={{ marginBottom: "16px", fontSize: '0.85rem', color: '#d1d5db' }}>
                           From <strong>{origin}</strong> to <strong>{destination}</strong>
                       </p>

                       {/* Route Options List */}
                       <div style={{ marginBottom: '20px' }}>
                           <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                               {(Array.isArray(suggestedRoutes) && suggestedRoutes.length > 0) ? (
                                   suggestedRoutes.map((route, index) => {
                                       if (!route?.properties?.label) { return <li key={`invalid-${index}`} style={{ color: 'red', padding: '5px' }}>Invalid route data</li>; }
                                       const isSelected = index === currentlySelectedIdx;
                                       const label = route.properties.label;
                                       const durationMin = route.properties.summary_duration ? (route.properties.summary_duration / 60).toFixed(0) : '?';
                                       const fare = route.properties.total_fare;
                                       const fareString = typeof fare === 'number' ? `P${fare.toFixed(2)}` : '';
                                       return (
                                           <li
                                               key={label + index}
                                               onClick={() => setCurrentlySelectedIdx(index)}
                                               style={{
                                                   border: `2px solid ${isSelected ? '#6ee7b7' : 'rgba(255,255,255,0.2)'}`,
                                                   backgroundColor: isSelected ? "rgba(110, 231, 183, 0.2)" : "rgba(255, 255, 255, 0.1)",
                                                   borderRadius: "6px", padding: "10px 12px", marginBottom: "8px",
                                                   cursor: "pointer", transition: 'background-color 0.2s ease, border-color 0.2s ease',
                                               }}
                                               onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'; }}
                                               onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'; }}
                                           >
                                               <div style={{ fontWeight: '600', fontSize: '0.95rem', marginBottom: '4px' }}>{label}</div>
                                               <div style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', color: '#d1d5db' }}>
                                                   <span>{durationMin !== '?' ? `~ ${durationMin} min` : 'Est. time unavailable'}</span>
                                                   <span>{fareString || 'Fare N/A'}</span>
                                               </div>
                                           </li>
                                       );
                                   })
                               ) : ( <li style={{ color: '#a0aec0' }}>No route options generated.</li> )}
                           </ul>
                       </div>

                       {/* Separator */}
                       <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.3)', margin: '20px 0' }} />

                       {/* Display Details for *Selected* Route */}
                       {currentRouteProps ? (
                       <>
                           <h2 style={{ fontSize: '1.1rem', marginBottom: '10px', fontWeight: '600' }}>Selected Route Details</h2>
                            <p style={{marginBottom: '15px', fontSize: '0.9rem'}}>
                                <span style={{fontWeight: 'bold'}}>{currentRouteLabel}</span> (~{getCurrentTotalDurationMin()} min, {getCurrentTotalFare() || 'Fare N/A'})
                            </p>

                           {/* Timeline */}
                           {currentSegments.length > 0 ? (
                               <div style={{
                                   display: "flex", height: "25px", width: "100%", overflow: "hidden",
                                   borderRadius: "6px", marginBottom: "20px", backgroundColor: '#374151'
                               }}>
                                   {currentSegments.map((seg, idx) => {
                                       if (!seg || !seg.mode) return <div key={`invalid-seg-${idx}`} style={{width: '5px', backgroundColor: 'red'}}></div>;
                                       const totalDuration = currentRouteProps?.summary_duration || 1;
                                       const widthPercent = totalDuration > 0 ? (((seg?.duration || 0) / totalDuration) * 100) : 0;
                                       const displayWidth = Math.max(widthPercent, 1);
                                       return (
                                           <div
                                               key={`${seg.mode}-${idx}`}
                                               title={`${seg.mode}: ${((seg?.duration || 0) / 60).toFixed(1)} min`}
                                               style={{
                                                   width: `${displayWidth}%`, backgroundColor: modeColors[seg.mode] || "#999", height: "100%",
                                                   display: "flex", alignItems: "center", justifyContent: "center",
                                                   fontSize: "0.7rem", color: "#fff", fontWeight: "bold",
                                                   overflow: 'hidden', whiteSpace: 'nowrap',
                                                   borderRight: idx < currentSegments.length - 1 ? '1px solid rgba(255,255,255,0.2)' : 'none'
                                               }}
                                           >
                                               {widthPercent > 18 ? seg.mode : (widthPercent > 8 ? <span className="material-icons" style={{fontSize: '16px'}}>{getModeIcon(seg.mode)}</span> : '')}
                                           </div>
                                       );
                                   })}
                               </div>
                           ) : ( <p style={{fontSize: '0.9rem', color: '#a0aec0'}}>No segments to display.</p> )}

                           {/* Steps Display */}
                           {currentSteps.length > 0 ? ( // Show AWS driving steps
                               <div style={{ backgroundColor: "rgba(255, 255, 255, 0.08)", borderRadius: "5px", padding: "12px 16px", marginBottom: "5px", textAlign: "left", maxHeight: '35vh', overflowY: 'auto' }}>
                                   <h3 style={{ fontSize: "1.0rem", marginBottom: "10px", fontWeight: '600' }}>Driving Steps</h3>
                                   {currentSteps.map((step, idx) => (
                                       <div key={idx} style={{ display: "flex", alignItems: "center", marginBottom: "8px", fontSize: '0.85rem' }}>
                                           <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#6ee7b7", marginRight: "10px", flexShrink: 0 }} />
                                           <span>{(step?.Distance || 0).toFixed(0)} m - {((step?.DurationSeconds || 0) / 60).toFixed(1)} min</span>
                                       </div>
                                   ))}
                               </div>
                           ) : currentSegments.length > 0 && currentRouteProps?.primary_mode !== 'Driving' ? ( // Show transit segments list instead
                               <div style={{ backgroundColor: "rgba(255, 255, 255, 0.08)", borderRadius: "5px", padding: "12px 16px", marginBottom: "5px", textAlign: "left", maxHeight: '35vh', overflowY: 'auto' }}>
                                   <h3 style={{ fontSize: "1.0rem", marginBottom: "10px", fontWeight: '600' }}>Transit Segments</h3>
                                   {currentSegments.map((seg, idx) => {
                                        if (!seg || !seg.mode) return <div key={`invalid-detail-${idx}`} style={{color: 'red', fontSize: '0.85rem'}}>Invalid segment data</div>;
                                        return (
                                            <div key={`seg-detail-${idx}`} style={{ display: "flex", alignItems: "center", marginBottom: "8px", fontSize: '0.85rem' }}>
                                                <span className="material-icons" style={{ marginRight: '8px', color: modeColors[seg.mode] || '#ccc', fontSize: '20px' }}>{getModeIcon(seg.mode)}</span>
                                                <span style={{flexGrow: 1}}>{seg.label || seg.mode} ({((seg?.duration || 0) / 60).toFixed(1)} min, {(seg?.distance / 1000).toFixed(1)} km)</span>
                                                 {seg.fare > 0 && <span style={{marginLeft: '10px', fontWeight: 'bold'}}>(P{seg.fare.toFixed(2)})</span>}
                                            </div>
                                        );
                                   })}
                               </div>
                           ) : ( <p style={{fontSize: '0.9rem', color: '#a0aec0'}}>No steps available for this route.</p> )}
                       </>
                       ) : ( <p style={{fontSize: '0.9rem', color: '#a0aec0', textAlign:'center', marginTop: '30px'}}>Select a route above to see details.</p> )}
                   </div> {/* End Scrollable Content Area */}
                </div> {/* End Sidebar Content */}
            </div> {/* End Sidebar */}

            {/* Map Container */}
            <div ref={mapContainerRef} style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0, zIndex: 1 }} />
        </div> // End Root Div
    );
};

export default RouteBreakdown;