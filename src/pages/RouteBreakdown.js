import React, { useEffect, useState, useRef, useMemo } from "react"; // Added useMemo
import { useLocation, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config"; // Ensure path is correct
import logo from "../assets/logo.png"; // Ensure path is correct
import * as turf from "@turf/turf"; // Import turf for bounding box calculation

// --- Mode Colors and Icons ---
const modeColors = {
    MRT: "#facc15", // Yellow-400
    LRT1: "#22c55e", // Green-500
    LRT2: "#7A07D1", // Purple
    LRT: "#22c55e",   // Fallback LRT
    Jeep: "#FFA500", // Orange
    "P2P-Bus": "#f97316", // Orange-500
    Bus: "#3b82f6", // Blue-500
    Walk: "#9ca3af", // Gray-400 (for dashed line)
    Driving: "#6b7280", // Gray-500
};

const getModeIcon = (mode = 'Unknown') => {
    switch (mode) {
        case 'MRT': return 'train';
        case 'LRT1': case 'LRT2': case 'LRT': return 'tram';
        case 'Bus': case 'P2P-Bus': return 'directions_bus';
        case 'Jeep': return 'airport_shuttle';
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

    // Extract state from navigation
    const {
        origin = 'Unknown Origin',
        destination = 'Unknown Destination',
        suggestedRoutes: initialSuggestedRoutes = [], // Rename to avoid conflict
        selectedRouteIndex = 0,
        awsRouteData = null,
    } = location.state || {};

    // --- State ---
    // Store the original, unsorted list
    const [originalRoutes] = useState(initialSuggestedRoutes);
    // State for sorting criteria
    const [sortBy, setSortBy] = useState('duration'); // 'duration', 'distance', 'fare'
    // State for the index of the currently selected route *in the sorted list*
    const [currentlySelectedIdx, setCurrentlySelectedIdx] = useState(selectedRouteIndex);
    // State to track the label of the selected route to maintain selection across sorts
    const [selectedRouteLabelState, setSelectedRouteLabelState] = useState(() =>
        initialSuggestedRoutes[selectedRouteIndex]?.properties?.label || null
    );

    // State for the details of the *currently viewed* route
    const [currentSegments, setCurrentSegments] = useState([]);
    const [currentSteps, setCurrentSteps] = useState([]);
    const [currentRouteLabel, setCurrentRouteLabel] = useState("Loading...");
    const [currentRouteProps, setCurrentRouteProps] = useState(null);
    const [isMapLoaded, setIsMapLoaded] = useState(false); // Track map load status
    // State for map features derived from selected route
    const [mapFeatures, setMapFeatures] = useState({ type: 'FeatureCollection', features: [] });

    // --- Sorting Logic ---
    const sortedSuggestedRoutes = useMemo(() => {
        if (!Array.isArray(originalRoutes)) return [];
        // Create a copy before sorting to avoid mutating original state/props
        const routesToSort = [...originalRoutes];

        routesToSort.sort((a, b) => {
            const propsA = a?.properties;
            const propsB = b?.properties;
            let valA = Infinity, valB = Infinity;

            switch (sortBy) {
                case 'distance':
                    valA = propsA?.summary_distance ?? Infinity;
                    valB = propsB?.summary_distance ?? Infinity;
                    break;
                case 'fare':
                    valA = propsA?.total_fare ?? Infinity;
                    valB = propsB?.total_fare ?? Infinity;
                    break;
                case 'duration':
                default:
                    valA = propsA?.summary_duration ?? Infinity;
                    valB = propsB?.summary_duration ?? Infinity;
                    break;
            }
            // Handle potential non-numeric values safely
            if (isNaN(valA)) valA = Infinity;
            if (isNaN(valB)) valB = Infinity;

            if (valA !== valB) {
                 return valA - valB; // Primary sort
            }
            // Secondary sort by duration if primary values are equal
            const durationA = propsA?.summary_duration ?? Infinity;
            const durationB = propsB?.summary_duration ?? Infinity;
             if (isNaN(durationA)) durationA = Infinity;
             if (isNaN(durationB)) durationB = Infinity;
            return durationA - durationB;
        });
        return routesToSort;
    }, [originalRoutes, sortBy]);

    // --- Effect to update index when sort changes ---
    useEffect(() => {
        if (selectedRouteLabelState) {
            const newIndex = sortedSuggestedRoutes.findIndex(route => route?.properties?.label === selectedRouteLabelState);
            if (newIndex !== -1 && newIndex !== currentlySelectedIdx) {
                console.log(`Sort changed. Updating selected index for label "${selectedRouteLabelState}" from ${currentlySelectedIdx} to ${newIndex}`);
                setCurrentlySelectedIdx(newIndex);
            } else if (newIndex === -1 && sortedSuggestedRoutes.length > 0) { // Check length before accessing index 0
                // Previously selected route might not exist after filtering/sorting? Reset.
                console.warn(`Previously selected route label "${selectedRouteLabelState}" not found after sorting. Resetting index.`);
                setCurrentlySelectedIdx(0); // Default to first item
                setSelectedRouteLabelState(sortedSuggestedRoutes[0]?.properties?.label || null); // Update label state
            } else if (newIndex === -1 && sortedSuggestedRoutes.length === 0) {
                 // Handle case where sorting results in empty list
                 setCurrentlySelectedIdx(0); // Or -1?
                 setSelectedRouteLabelState(null);
            }
        } else if (sortedSuggestedRoutes.length > 0) {
             // If no label was selected, default to the first item in the newly sorted list
             setCurrentlySelectedIdx(0);
             setSelectedRouteLabelState(sortedSuggestedRoutes[0]?.properties?.label || null);
        }
    // Avoid infinite loops by ensuring currentlySelectedIdx is only set when necessary
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sortedSuggestedRoutes, selectedRouteLabelState]); // Removed currentlySelectedIdx dependency

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
        let isMounted = true; // Flag for cleanup check

        const map = new maplibregl.Map({
            container: mapContainerRef.current,
            style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
            center: [121.0357, 14.4981], // Initial center
            zoom: 11,
        });
        mapRef.current = map;

        map.once('load', () => { // Use 'once' if setup only needs to happen once
            if (!mapRef.current || !isMounted) return;
            console.log("Map 'load' event fired. Setting up sources/layers.");
            // Set map loaded state to true
            setIsMapLoaded(true);

            // Setup Source and Layers for Segments
            if (!mapRef.current.getSource('route-segments')) {
                mapRef.current.addSource('route-segments', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] }
                });
                console.log("Map source 'route-segments' added.");
            }

            Object.keys(modeColors).forEach(mode => {
                const layerId = `route-segment-${mode}`;
                if (!mapRef.current.getLayer(layerId)) {
                    mapRef.current.addLayer({
                        id: layerId, type: 'line', source: 'route-segments',
                        filter: ['==', ['get', 'mode'], mode],
                        layout: { 'line-join': 'round', 'line-cap': 'round' },
                        paint: {
                            'line-color': modeColors[mode],
                            'line-width': mode === 'Walk' ? 4 : 6,
                            'line-opacity': 0.85,
                            ...(mode === 'Walk' && { 'line-dasharray': [2, 2] })
                        }
                    });
                }
            });
            console.log("Segment layers added/verified.");
        });

        map.on('error', (e) => console.error("MapLibre Error:", e));

        return () => {
            isMounted = false;
            if (mapRef.current) {
                if (mapRef.current.getStyle()) { /* No listeners to remove here */ }
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Map initialization runs once

    // --- Load/Update Route Details (UI State & Prepare Map Features) ---
    useEffect(() => {
        // Use sortedSuggestedRoutes here
        if (!Array.isArray(sortedSuggestedRoutes) || sortedSuggestedRoutes.length === 0) {
             console.warn("No suggested routes available.");
             setCurrentSegments([]); setCurrentSteps([]); setCurrentRouteLabel("No routes found."); setCurrentRouteProps(null);
             setMapFeatures({ type: 'FeatureCollection', features: [] }); return;
         }
        if (currentlySelectedIdx < 0 || currentlySelectedIdx >= sortedSuggestedRoutes.length) {
             console.warn(`Selected index ${currentlySelectedIdx} out of bounds. List length: ${sortedSuggestedRoutes.length}. Resetting.`);
             // Reset to 0 only if list is not empty
             setCurrentlySelectedIdx(sortedSuggestedRoutes.length > 0 ? 0 : -1); // Use -1 or 0?
             return;
        }
        const selectedRoute = sortedSuggestedRoutes[currentlySelectedIdx]; // Get from sorted list

        if (!selectedRoute?.properties?.segments || !selectedRoute?.properties?.label) {
             console.error("Selected route object (index " + currentlySelectedIdx + ") is invalid.", selectedRoute);
             setCurrentSegments([]); setCurrentSteps([]); setCurrentRouteLabel("Invalid route data"); setCurrentRouteProps(null);
             setMapFeatures({ type: 'FeatureCollection', features: [] }); return;
        }

        console.log(`Loading details for sorted index ${currentlySelectedIdx}: ${selectedRoute.properties.label}`);
        setCurrentRouteLabel(selectedRoute.properties.label);
        setCurrentRouteProps(selectedRoute.properties);
        // Don't set selectedRouteLabelState here, it's handled by onClick and the sync effect

        // 1. Update Segments state for UI
        const segmentsForUI = selectedRoute.properties.segments.filter(seg => seg && typeof seg.mode === 'string');
        setCurrentSegments(segmentsForUI);

        // 2. Update AWS Steps state
        if (selectedRoute.properties.primary_mode === 'Driving' && Array.isArray(awsRouteData?.Legs?.[0]?.Steps)) {
            setCurrentSteps(awsRouteData.Legs[0].Steps);
        } else {
            setCurrentSteps([]);
        }

        // 3. Prepare Features for the Map (update mapFeatures state)
         const segmentFeatures = selectedRoute.properties.segments
             .map((seg, index) => {
                 // console.log(`Checking segment ${index} (mode: ${seg?.mode}):`, JSON.stringify(seg));
                 // console.log(` -> Geometry object for segment ${index}:`, seg?.geometry);

                 if (seg?.geometry && seg.geometry.type === 'LineString' && Array.isArray(seg.geometry.coordinates) && seg.geometry.coordinates.length >= 2) {
                     return {
                         type: 'Feature',
                         geometry: seg.geometry,
                         properties: { mode: seg.mode || 'Unknown', label: seg.label, }
                     };
                 } else {
                     console.warn(`Segment ${index} (mode: ${seg?.mode}) has invalid geometry structure or coordinates. Skipping map feature.`);
                     return null;
                 }
             })
             .filter(feature => feature !== null);
         setMapFeatures({ type: 'FeatureCollection', features: segmentFeatures });
         console.log(`Prepared ${segmentFeatures.length} features for map.`);

    }, [currentlySelectedIdx, sortedSuggestedRoutes, awsRouteData]); // Depends on index and the *sorted* list


    // --- Update Map View (Separate Effect - Uses requestAnimationFrame) ---
    useEffect(() => {
        // Exit if map isn't loaded or features haven't been prepared
        if (!isMapLoaded || !mapRef.current) {
            console.log(`Map update skipped: Map not ready (isMapLoaded: ${isMapLoaded}, mapRef: ${!!mapRef.current})`);
            return;
        }

        let animationFrameId = null; // To cancel pending frame requests

        // Define the action to perform the map update
        const performMapUpdate = () => {
            // Double-check map instance existence within the frame callback
            if (!mapRef.current) {
                console.log("Map update cancelled: Map reference lost.");
                return;
            }

            // Check if the style is loaded NOW
            if (mapRef.current.isStyleLoaded()) {
                console.log("Map style IS loaded, attempting map update with features:", mapFeatures.features.length);
                const source = mapRef.current.getSource('route-segments');
                if (source) {
                    try {
                        source.setData(mapFeatures); // Use mapFeatures state
                        console.log(` -> Updated map source 'route-segments' with ${mapFeatures.features.length} segment features.`);

                        // Fit bounds logic
                        // Get the selected route from the *sorted* list using the current index
                        const selectedRoute = sortedSuggestedRoutes[currentlySelectedIdx];
                        let geometryForBounds = selectedRoute?.geometry; // Prefer combined geometry
                        if (!geometryForBounds && mapFeatures.features.length > 0) {
                             try { geometryForBounds = turf.featureCollection(mapFeatures.features); } // Fallback to segments
                             catch(e) { console.error("Error creating feature collection for bounds:", e); }
                        }
                        if (geometryForBounds) {
                             try {
                                 const bounds = turf.bbox(geometryForBounds);
                                 if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(n => typeof n === 'number' && !isNaN(n))) {
                                     mapRef.current.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 380, right: 60 }, maxZoom: 16, duration: 500 });
                                 } else { console.warn("Could not calculate valid bounds.", bounds); }
                             } catch (e) { console.error("Error fitting bounds:", e); }
                        } else { console.warn(`No valid geometry found for bounds.`); }
                    } catch (error) {
                         console.error("Error setting map source data:", error);
                    }
                } else { console.error("Map source 'route-segments' not found during update!"); }
            } else {
                // Style not loaded yet, request another frame
                console.log("Map style still not loaded, requesting next animation frame.");
                animationFrameId = requestAnimationFrame(performMapUpdate);
            }
        };

        // Request the first animation frame to start the update process
        console.log("Requesting animation frame for map update.");
        animationFrameId = requestAnimationFrame(performMapUpdate);

        // Cleanup function to cancel the frame request if the component unmounts
        // or if the dependencies change before the frame runs
        return () => {
            if (animationFrameId) {
                console.log("Cancelling pending animation frame for map update.");
                cancelAnimationFrame(animationFrameId);
            }
        };

    // Depend on mapFeatures and isMapLoaded. Also include currentlySelectedIdx/sortedSuggestedRoutes
    // to ensure fitBounds uses the correct data if mapFeatures changes structurally but not content-wise.
    }, [mapFeatures, isMapLoaded, currentlySelectedIdx, sortedSuggestedRoutes]);


    // --- Calculate Display Values ---
    const getCurrentTotalDurationMin = () => {
        const durationSec = currentRouteProps?.summary_duration;
        return typeof durationSec === 'number' && !isNaN(durationSec) ? (durationSec / 60).toFixed(0) : 'N/A';
    };
    const getCurrentTotalFare = () => {
        const fare = currentRouteProps?.total_fare;
        return typeof fare === 'number' && !isNaN(fare) ? `P${fare.toFixed(2)}` : '';
    };

    // --- Event Handler for Sort Change ---
    const handleSortChange = (event) => {
        setSortBy(event.target.value);
        // The index sync effect will handle updating currentlySelectedIdx
    };


    // --- JSX Return ---
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
                           Back to Navigation
                       </button>
                   </div>

                   {/* Scrollable Content Area */}
                   <div style={{ padding: "0 16px 16px 16px", overflowY: 'auto', flexGrow: 1 }}>
                       {/* Header */}
                       <h1 style={{ fontSize: "1.4rem", fontWeight: "bold", marginBottom: "8px" }}>Route Options</h1>
                       <p style={{ marginBottom: "16px", fontSize: '0.85rem', color: '#d1d5db' }}>
                           From <strong>{origin}</strong> to <strong>{destination}</strong>
                       </p>

                       {/* --- Sort Dropdown --- */}
                       <div style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <label htmlFor="sort-select" style={{ fontSize: '0.9rem', fontWeight: '600' }}>Sort by:</label>
                            <select
                                id="sort-select"
                                value={sortBy}
                                onChange={handleSortChange}
                                style={{
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    color: 'black',
                                    border: '1px solid rgba(255, 255, 255, 0.3)',
                                    borderRadius: '4px',
                                    padding: '5px 8px',
                                    fontSize: '0.85rem',
                                    flexGrow: 1 // Allow it to take space
                                }}
                            >
                                <option value="duration">Fastest</option>
                                <option value="distance">Shortest Distance</option>
                                <option value="fare">Cheapest</option>
                            </select>
                       </div>
                       {/* --- End Sort Dropdown --- */}


                       {/* Route Options List (Maps over sortedSuggestedRoutes) */}
                       <div style={{ marginBottom: '20px' }}>
                           <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                               {(Array.isArray(sortedSuggestedRoutes) && sortedSuggestedRoutes.length > 0) ? (
                                   sortedSuggestedRoutes.map((route, index) => { // Use sorted list
                                       if (!route?.properties?.label) { return <li key={`invalid-${index}`} style={{ color: 'red', padding: '5px' }}>Invalid route data</li>; }
                                       // Check selection based on index *in the sorted list*
                                       const isSelected = index === currentlySelectedIdx;
                                       const label = route.properties.label;
                                       const durationMin = route.properties.summary_duration ? (route.properties.summary_duration / 60).toFixed(0) : '?';
                                       const fare = route.properties.total_fare;
                                       const fareString = typeof fare === 'number' ? `P${fare.toFixed(2)}` : '';
                                       return (
                                           <li
                                               key={label + index} // Key should ideally be more stable if possible
                                               onClick={() => {
                                                   // Set both index and label on click
                                                   setCurrentlySelectedIdx(index);
                                                   setSelectedRouteLabelState(label);
                                               }}
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
