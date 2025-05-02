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
    MRT: "#facc15",
    LRT: "#22c55e",
    Jeep: "#FFA500",
    "P2P-Bus": "#f97316",
    Bus: "#3b82f6",
    Walk: "#cbd5e1",
    Driving: "#64748b",
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
    const [currentSegments, setCurrentSegments] = useState([]);
    const [currentSteps, setCurrentSteps] = useState([]);
    const [currentRouteLabel, setCurrentRouteLabel] = useState("Loading...");
    const [currentRouteProps, setCurrentRouteProps] = useState(null);

    // --- Initialize Map ---
    useEffect(() => {
        // Make sure Google Fonts link is added (if not globally added in index.html)
        const iconsLink = document.getElementById('material-icons-link');
        if (!iconsLink) {
             const link = document.createElement('link');
             link.id = 'material-icons-link';
             link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
             link.rel = 'stylesheet';
             document.head.appendChild(link);
        }
        // ------------------------------------------------------

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
            // Add source and layer for drawing the selected route line
            if (!mapRef.current.getSource('route-geometry')) {
                mapRef.current.addSource('route-geometry', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            }
            if (!mapRef.current.getLayer('route-line')) {
                mapRef.current.addLayer({
                    id: 'route-line',
                    type: 'line',
                    source: 'route-geometry',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': ['match', ['get', 'primary_mode'], // Color line based on primary mode
                            'MRT', modeColors.MRT,
                            'LRT', modeColors.LRT,
                            'Bus', modeColors.Bus,
                            'P2P-Bus', modeColors['P2P-Bus'],
                            'Jeep', modeColors.Jeep,
                            'Driving', modeColors.Driving,
                            /* default */ '#888' // Fallback color
                        ],
                        'line-width': 6, // Make line slightly thicker
                        'line-opacity': 0.85
                     }
                });
            }
            // Add markers for start/end? (Requires coordinate data)
            // Example (needs refinement):
            // if (suggestedRoutes[currentlySelectedIdx]?.geometry?.coordinates) {
            //    const coords = suggestedRoutes[currentlySelectedIdx].geometry.coordinates;
            //    new maplibregl.Marker().setLngLat(coords[0]).addTo(map); // Start marker
            //    new maplibregl.Marker({color: '#FF0000'}).setLngLat(coords[coords.length-1]).addTo(map); // End marker
            // }

        });

        map.on('error', (e) => console.error("MapLibre Error:", e));

        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, []); // Run map initialization only once

    // --- Load/Update Route Details When Selection Changes ---
    useEffect(() => {
        if (!Array.isArray(suggestedRoutes) || suggestedRoutes.length === 0) {
            console.warn("No suggested routes available.");
            setCurrentSegments([]); setCurrentSteps([]); setCurrentRouteLabel("No routes found."); setCurrentRouteProps(null);
            if (mapRef.current?.getSource('route-geometry')) { // Clear map
                 mapRef.current.getSource('route-geometry').setData({ type: 'FeatureCollection', features: [] });
            }
            return;
        }

        // Ensure index is valid before accessing array
        if (currentlySelectedIdx < 0 || currentlySelectedIdx >= suggestedRoutes.length) {
            console.warn(`Selected index ${currentlySelectedIdx} out of bounds. Resetting to 0.`);
            setCurrentlySelectedIdx(0); // Reset to valid index
            return; // Effect will re-run with the new index
        }

        const selectedRoute = suggestedRoutes[currentlySelectedIdx];

        // Validate the selected route object structure
        if (!selectedRoute || typeof selectedRoute !== 'object' || !selectedRoute.properties || !Array.isArray(selectedRoute.properties.segments) || typeof selectedRoute.properties.label !== 'string') {
            console.error("Selected route object (index " + currentlySelectedIdx + ") is invalid or missing required properties (label or segments).", selectedRoute);
            setCurrentSegments([]); setCurrentSteps([]); setCurrentRouteLabel("Invalid route data"); setCurrentRouteProps(null);
             if (mapRef.current?.getSource('route-geometry')) { // Clear map
                 mapRef.current.getSource('route-geometry').setData({ type: 'FeatureCollection', features: [] });
             }
            return;
        }

        console.log(`Loading details for index ${currentlySelectedIdx}: ${selectedRoute.properties.label}`);
        setCurrentRouteLabel(selectedRoute.properties.label);
        setCurrentRouteProps(selectedRoute.properties); // Store properties

        // 1. Update Segments for Timeline & Step List
        const segmentsValid = selectedRoute.properties.segments.every(seg => seg && typeof seg.mode === 'string'); // Basic check
        if (segmentsValid) {
             setCurrentSegments(selectedRoute.properties.segments);
        } else {
             console.error("Invalid segments found in selected route:", selectedRoute.properties.segments);
             setCurrentSegments([]);
        }


        // 2. Update AWS Steps (Only for 'Driving' primary mode)
        if (selectedRoute.properties.primary_mode === 'Driving' && Array.isArray(awsRouteData?.Legs?.[0]?.Steps)) {
            setCurrentSteps(awsRouteData.Legs[0].Steps);
        } else {
            setCurrentSteps([]); // Clear AWS steps for non-driving routes
        }

        // 3. Update Map View
        if (mapRef.current?.isStyleLoaded()) { // Check if map style is ready
             if (selectedRoute.geometry && selectedRoute.geometry.type === 'LineString' && Array.isArray(selectedRoute.geometry.coordinates) && selectedRoute.geometry.coordinates.length >= 2) {
                 const routeGeoJSON = {
                     type: 'FeatureCollection',
                     features: [selectedRoute] // Pass the whole feature including properties
                 };
                 // Update the data source for the route line layer
                 mapRef.current.getSource('route-geometry')?.setData(routeGeoJSON);

                 // Fit map to the selected route's bounds
                 try {
                     const bounds = turf.bbox(selectedRoute.geometry);
                     if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(n => typeof n === 'number' && !isNaN(n))) {
                         mapRef.current.fitBounds(bounds, {
                             padding: { top: 60, bottom: 60, left: 380, right: 60 }, // Adjusted padding: more left padding for sidebar
                             maxZoom: 16,
                             duration: 500 // Add smooth transition
                         });
                     } else {
                         console.warn("Could not calculate valid bounds for route geometry:", bounds);
                     }
                 } catch (e) {
                     console.error("Error calculating or fitting bounds:", e);
                 }
             } else {
                 console.warn(`Selected route (index ${currentlySelectedIdx}) has missing or invalid geometry. Clearing map line.`);
                 mapRef.current.getSource('route-geometry')?.setData({ type: 'FeatureCollection', features: [] }); // Clear map line
             }
        } else {
             console.log("Map style not loaded yet, map update skipped.");
             // Optionally, retry setting data once style is loaded
        }

    }, [currentlySelectedIdx, suggestedRoutes, awsRouteData]); // Re-run when index, routes, or AWS data change

    // --- Calculate Display Values for Selected Route ---
    const getCurrentTotalDurationMin = () => {
        const durationSec = currentRouteProps?.summary_duration;
        // Use toFixed(0) for whole minutes in summary for clarity
        return typeof durationSec === 'number' && !isNaN(durationSec) ? (durationSec / 60).toFixed(0) : 'N/A';
    };
    const getCurrentTotalFare = () => {
        const fare = currentRouteProps?.total_fare;
        return typeof fare === 'number' && !isNaN(fare) ? `P${fare.toFixed(2)}` : '';
    };


    // --- JSX Return ---
    return (
        <div style={{ position: "relative", height: "100vh", fontFamily: "Montserrat, sans-serif" }}>
            {/* Sidebar */}
            <div style={{
                position: "absolute", left: 0, top: 0, width: "350px", height: "100%",
                backdropFilter: "blur(5px)", backgroundColor: "rgba(0, 0, 0, 0.75)",
                zIndex: 10, display: "flex", flexDirection: "column",
                boxShadow: '3px 0px 10px rgba(0,0,0,0.3)' // Add shadow
            }}>
                {/* Sidebar Content - Make it scrollable */}
                <div style={{ color: "white", overflowY: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>

                   {/* Top Bar (Logo & Back Button) */}
                   <div style={{ padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 /* Prevent shrinking */ }}>
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
                           {/* <h2 style={{ fontSize: '1.1rem', marginBottom: '10px' }}>Available Routes:</h2> */}
                           <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                               {(Array.isArray(suggestedRoutes) && suggestedRoutes.length > 0) ? (
                                   suggestedRoutes.map((route, index) => {
                                       // Basic validation of route object structure
                                       if (!route?.properties?.label) {
                                           console.warn(`Route at index ${index} is missing properties or label.`);
                                           return <li key={`invalid-${index}`} style={{ color: 'red', padding: '5px' }}>Invalid route data</li>;
                                       }

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
                                                   borderRadius: "6px",
                                                   padding: "10px 12px",
                                                   marginBottom: "8px",
                                                   cursor: "pointer",
                                                   transition: 'background-color 0.2s ease, border-color 0.2s ease',
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
                               ) : (
                                   <li style={{ color: '#a0aec0' }}>No route options generated.</li>
                               )}
                           </ul>
                       </div>

                       {/* Separator */}
                       <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.3)', margin: '20px 0' }} />

                       {/* Display Details for *Selected* Route */}
                       {currentRouteProps ? ( // Only show details if a route is properly selected
                       <>
                           <h2 style={{ fontSize: '1.1rem', marginBottom: '10px', fontWeight: '600' }}>
                               Selected Route Details
                           </h2>
                            <p style={{marginBottom: '15px', fontSize: '0.9rem'}}>
                                <span style={{fontWeight: 'bold'}}>{currentRouteLabel}</span> (~{getCurrentTotalDurationMin()} min, {getCurrentTotalFare() || 'Fare N/A'})
                            </p>


                           {/* Timeline (uses currentSegments state) */}
                           {currentSegments.length > 0 ? (
                               <div style={{
                                   display: "flex", height: "25px", width: "100%", overflow: "hidden",
                                   borderRadius: "6px", marginBottom: "20px", backgroundColor: '#374151'
                               }}>
                                   {currentSegments.map((seg, idx) => {
                                       // Added safety check for segment and mode
                                       if (!seg || !seg.mode) return <div key={`invalid-seg-${idx}`} style={{width: '5px', backgroundColor: 'red'}}></div>;

                                       const totalDuration = currentRouteProps?.summary_duration || 1; // Avoid division by zero if summary_duration is missing
                                       const widthPercent = totalDuration > 0 ? (((seg?.duration || 0) / totalDuration) * 100) : 0;
                                       const displayWidth = Math.max(widthPercent, 1); // Ensure minimum width %

                                       return (
                                           <div
                                               key={`${seg.mode}-${idx}`}
                                               title={`${seg.mode}: ${((seg?.duration || 0) / 60).toFixed(1)} min`}
                                               style={{
                                                   width: `${displayWidth}%`,
                                                   backgroundColor: modeColors[seg.mode] || "#999",
                                                   height: "100%",
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
                           ) : (
                               <p style={{fontSize: '0.9rem', color: '#a0aec0'}}>No segments to display.</p>
                           )}

                           {/* Steps Display */}
                           {currentSteps.length > 0 ? ( // Show AWS driving steps
                               <div style={{
                                   backgroundColor: "rgba(255, 255, 255, 0.08)", borderRadius: "5px",
                                   padding: "12px 16px", marginBottom: "5px", textAlign: "left", maxHeight: '35vh', overflowY: 'auto'
                               }}>
                                   <h3 style={{ fontSize: "1.0rem", marginBottom: "10px", fontWeight: '600' }}>
                                       Driving Steps
                                   </h3>
                                   {currentSteps.map((step, idx) => (
                                       <div key={idx} style={{ display: "flex", alignItems: "center", marginBottom: "8px", fontSize: '0.85rem' }}>
                                           <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#6ee7b7", marginRight: "10px", flexShrink: 0 }} />
                                           <span>
                                               {(step?.Distance || 0).toFixed(0)} m - {((step?.DurationSeconds || 0) / 60).toFixed(1)} min
                                           </span>
                                       </div>
                                   ))}
                               </div>
                           ) : currentSegments.length > 0 && currentRouteProps?.primary_mode !== 'Driving' ? ( // Show transit segments list instead
                               <div style={{
                                   backgroundColor: "rgba(255, 255, 255, 0.08)", borderRadius: "5px",
                                   padding: "12px 16px", marginBottom: "5px", textAlign: "left", maxHeight: '35vh', overflowY: 'auto'
                               }}>
                                   <h3 style={{ fontSize: "1.0rem", marginBottom: "10px", fontWeight: '600' }}>
                                       Transit Segments
                                   </h3>
                                   {currentSegments.map((seg, idx) => {
                                        // Added safety check for segment and mode
                                        if (!seg || !seg.mode) return <div key={`invalid-detail-${idx}`} style={{color: 'red', fontSize: '0.85rem'}}>Invalid segment data</div>;
                                        return (
                                            <div key={`seg-detail-${idx}`} style={{ display: "flex", alignItems: "center", marginBottom: "8px", fontSize: '0.85rem' }}>
                                                <span className="material-icons" style={{ marginRight: '8px', color: modeColors[seg.mode] || '#ccc', fontSize: '20px' }}>{getModeIcon(seg.mode)}</span>
                                                <span style={{flexGrow: 1}}>
                                                    {seg.label || seg.mode} ({((seg?.duration || 0) / 60).toFixed(1)} min, {(seg?.distance / 1000).toFixed(1)} km)
                                                </span>
                                                 {seg.fare > 0 && <span style={{marginLeft: '10px', fontWeight: 'bold'}}>(P{seg.fare.toFixed(2)})</span>}
                                            </div>
                                        );
                                   })}
                               </div>
                           ) : (
                               <p style={{fontSize: '0.9rem', color: '#a0aec0'}}>No steps available for this route.</p>
                           )}
                        </>
                       ) : (
                          <p style={{fontSize: '0.9rem', color: '#a0aec0', textAlign:'center', marginTop: '30px'}}>Select a route above to see details.</p>
                       )}


                   </div> {/* End Scrollable Content Area */}
                </div> {/* End Sidebar Content */}
            </div> {/* End Sidebar */}

            {/* Map Container */}
            <div
                ref={mapContainerRef}
                style={{
                    width: "100%", height: "100%", position: "absolute",
                    top: 0, left: 0, zIndex: 1 // Map is behind sidebar
                }}
            />
        </div> // End Root Div
    );
};

export default RouteBreakdown;