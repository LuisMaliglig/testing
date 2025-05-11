import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config"; // Ensure path is correct
import logo from "../assets/logo.png"; // Ensure path is correct
import * as turf from "@turf/turf"; // Import turf for bounding box calculation
import transitRouteData from "../data/transit-lines.json"; // Import the full data for stop lookups

// --- Mode Colors and Icons ---
const modeColors = {
    MRT: "#facc15", // Yellow-400
    LRT1: "#22c55e", // Green-500
    LRT2: "#7A07D1", // Purple
    Jeep: "#FFA500", // Orange
    "P2P-Bus": "#f97316", // Orange-500
    Bus: "#3b82f6", // Blue-500
    Walk: "#9ca3af", // Gray-400 (for dashed line)
    Driving: "#6b7280", // Gray-500
    // Stop colors (can be same or different)
    "MRT-Stop": "#facc15",
    "LRT1-Stop": "#22c55e",
    "LRT2-Stop": "#7A07D1",
    "Bus-Stop": "#3b82f6",
    "P2P-Bus-Stop": "#f97316",
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
    const stopMarkersRef = useRef([]); // Ref to store current stop markers
    const navigate = useNavigate();
    const location = useLocation();

    // Extract state from navigation
    const {
        origin = 'Unknown Origin',
        destination = 'Unknown Destination',
        suggestedRoutes: initialSuggestedRoutes = [],
        selectedRouteIndex = 0,
        awsRouteData = null,
    } = location.state || {};

    // --- State ---
    const [originalRoutes] = useState(initialSuggestedRoutes);
    const [sortBy, setSortBy] = useState('duration');
    const [currentlySelectedIdx, setCurrentlySelectedIdx] = useState(selectedRouteIndex);
    const [selectedRouteLabelState, setSelectedRouteLabelState] = useState(() =>
        initialSuggestedRoutes[selectedRouteIndex]?.properties?.label || null
    );
    const [currentSegments, setCurrentSegments] = useState([]);
    const [currentSteps, setCurrentSteps] = useState([]);
    const [currentRouteLabel, setCurrentRouteLabel] = useState("Loading...");
    const [currentRouteProps, setCurrentRouteProps] = useState(null);
    const [isMapLoaded, setIsMapLoaded] = useState(false);
    const [mapFeatures, setMapFeatures] = useState({ type: 'FeatureCollection', features: [] });
    const [expandedSegmentIndex, setExpandedSegmentIndex] = useState(null);
    const [isSidebarVisible, setIsSidebarVisible] = useState(true);


    // --- Sorting Logic ---
    const sortedSuggestedRoutes = useMemo(() => {
        if (!Array.isArray(originalRoutes)) return [];
        const routesToSort = [...originalRoutes];
        routesToSort.sort((a, b) => {
            const propsA = a?.properties; const propsB = b?.properties;
            let valA = Infinity, valB = Infinity;
            switch (sortBy) {
                case 'distance': valA = propsA?.summary_distance ?? Infinity; valB = propsB?.summary_distance ?? Infinity; break;
                case 'fare': valA = propsA?.total_fare ?? Infinity; valB = propsB?.total_fare ?? Infinity; break;
                default: valA = propsA?.summary_duration ?? Infinity; valB = propsB?.summary_duration ?? Infinity; break;
            }
            if (isNaN(valA)) valA = Infinity; if (isNaN(valB)) valB = Infinity;
            if (valA !== valB) { return valA - valB; }
            let durationA = propsA?.summary_duration ?? Infinity; let durationB = propsB?.summary_duration ?? Infinity;
            if (isNaN(durationA)) durationA = Infinity; if (isNaN(durationB)) durationB = Infinity;
            return durationA - durationB;
        });
        return routesToSort;
    }, [originalRoutes, sortBy]);

    // --- Effect to update index when sort changes ---
    useEffect(() => {
        if (selectedRouteLabelState) {
            const newIndex = sortedSuggestedRoutes.findIndex(route => route?.properties?.label === selectedRouteLabelState);
            if (newIndex !== -1 && newIndex !== currentlySelectedIdx) {
                setCurrentlySelectedIdx(newIndex);
            } else if (newIndex === -1 && sortedSuggestedRoutes.length > 0) {
                setCurrentlySelectedIdx(0);
                setSelectedRouteLabelState(sortedSuggestedRoutes[0]?.properties?.label || null);
            } else if (newIndex === -1 && sortedSuggestedRoutes.length === 0) {
                 setCurrentlySelectedIdx(0); setSelectedRouteLabelState(null);
            }
        } else if (sortedSuggestedRoutes.length > 0) {
             setCurrentlySelectedIdx(0);
             setSelectedRouteLabelState(sortedSuggestedRoutes[0]?.properties?.label || null);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sortedSuggestedRoutes, selectedRouteLabelState]);

    // --- Function to clear stop markers ---
    const clearStopMarkers = useCallback(() => {
        stopMarkersRef.current.forEach(marker => marker.remove());
        stopMarkersRef.current = [];
    }, []);

    // --- Initialize Map ---
    useEffect(() => {
        const iconsLink = document.getElementById('material-icons-link');
        if (!iconsLink) {
             const link = document.createElement('link'); link.id = 'material-icons-link';
             link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
             link.rel = 'stylesheet'; document.head.appendChild(link);
        }
        if (!mapContainerRef.current) return;
        let isMounted = true;
        const map = new maplibregl.Map({
             container: mapContainerRef.current,
             style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
             center: [121.0357, 14.4981], zoom: 11,
        });
        mapRef.current = map;
        map.once('load', () => {
            if (!mapRef.current || !isMounted) return;
            console.log("Map 'load' event fired.");
            setIsMapLoaded(true);
            if (!mapRef.current.getSource('route-segments')) {
                mapRef.current.addSource('route-segments', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
            }
            Object.keys(modeColors).forEach(mode => {
                if (!mode.includes("-Stop")) { // Only add line layers here
                    const layerId = `route-segment-${mode}`;
                    if (!mapRef.current.getLayer(layerId)) {
                        mapRef.current.addLayer({
                            id: layerId, type: 'line', source: 'route-segments',
                            filter: ['==', ['get', 'mode'], mode],
                            layout: { 'line-join': 'round', 'line-cap': 'round' },
                            paint: {
                                'line-color': modeColors[mode] || '#888',
                                'line-width': mode === 'Walk' ? 4 : 6,
                                'line-opacity': 0.85,
                                ...(mode === 'Walk' && { 'line-dasharray': [2, 2] })
                            }
                        });
                    }
                }
            });
            console.log("Segment layers added/verified.");
        });
        map.on('error', (e) => console.error("MapLibre Error:", e));
        return () => {
            isMounted = false;
            if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
            clearStopMarkers();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // --- Load/Update Route Details ---
    useEffect(() => {
        if (!Array.isArray(sortedSuggestedRoutes) || sortedSuggestedRoutes.length === 0) { /*...*/ return; }
        if (currentlySelectedIdx < 0 || currentlySelectedIdx >= sortedSuggestedRoutes.length) { /*...*/ return; }
        const selectedRoute = sortedSuggestedRoutes[currentlySelectedIdx];
        if (!selectedRoute?.properties?.segments || !selectedRoute?.properties?.label) { /*...*/ return; }

        console.log(`Loading details for sorted index ${currentlySelectedIdx}: ${selectedRoute.properties.label}`);
        setCurrentRouteLabel(selectedRoute.properties.label);
        setCurrentRouteProps(selectedRoute.properties);

        const segmentsForUI = selectedRoute.properties.segments.filter(seg => seg && typeof seg.mode === 'string');
        setCurrentSegments(segmentsForUI);

        if (selectedRoute.properties.primary_mode === 'Driving' && Array.isArray(awsRouteData?.Legs?.[0]?.Steps)) {
            setCurrentSteps(awsRouteData.Legs[0].Steps);
        } else { setCurrentSteps([]); }

         const segmentFeatures = selectedRoute.properties.segments
             .map((seg) => {
                 if (seg?.geometry && seg.geometry.type === 'LineString' && Array.isArray(seg.geometry.coordinates) && seg.geometry.coordinates.length >= 2) {
                     return { type: 'Feature', geometry: seg.geometry, properties: { mode: seg.mode || 'Unknown', label: seg.label } };
                 } return null;
             })
             .filter(feature => feature !== null);
         setMapFeatures({ type: 'FeatureCollection', features: segmentFeatures });
         console.log(`Prepared ${segmentFeatures.length} features for map.`);
         setExpandedSegmentIndex(null);
         clearStopMarkers();

    }, [currentlySelectedIdx, sortedSuggestedRoutes, awsRouteData, clearStopMarkers]);


    // --- Function to add stop markers based on segment geometry and mode ---
    const addStopMarkersForSegment = useCallback((segmentGeometry, segmentMode, stopSequence) => {
        if (!mapRef.current || !segmentGeometry || !segmentMode || !Array.isArray(stopSequence) || stopSequence.length === 0) {
            console.log("Skipping addStopMarkers: Missing map, geometry, mode, or stopSequence.");
            return;
        }
        clearStopMarkers();

        // Find the corresponding stop features from the main transit data
        const stopFeatures = stopSequence.map(stopName =>
            transitRouteData.features.find(f =>
                f.geometry?.type === 'Point' && f.properties?.name === stopName
            )
        ).filter(Boolean); // Filter out any stops not found in the main data

        stopFeatures.forEach((stopFeature, index) => {
            const el = document.createElement('div');
            el.className = 'stop-marker';
            // Determine color based on stop type, fallback to gray
            const stopTypeColor = modeColors[stopFeature.properties.type] || modeColors[segmentMode] ||'#888';
            el.style.backgroundColor = stopTypeColor;
            el.style.width = '10px'; // Slightly smaller markers for stops
            el.style.height = '10px';
            el.style.borderRadius = '50%';
            el.style.border = '1.5px solid white';
            el.style.boxShadow = '0 0 4px rgba(0,0,0,0.6)';
            el.title = `${index + 1}. ${stopFeature.properties.name}`; // Add tooltip

            const marker = new maplibregl.Marker(el)
                .setLngLat(stopFeature.geometry.coordinates)
                .addTo(mapRef.current);
            stopMarkersRef.current.push(marker);
        });
        console.log(`Added ${stopMarkersRef.current.length} stop markers for the segment.`);
    }, [clearStopMarkers]);


    // --- Update Map View (Route Lines) ---
    useEffect(() => {
        if (!isMapLoaded || !mapRef.current) { return; }
        let animationFrameId = null;
        const performMapUpdate = () => {
            if (!mapRef.current?.isStyleLoaded()) {
                animationFrameId = requestAnimationFrame(performMapUpdate); return;
            }
            const source = mapRef.current.getSource('route-segments');
            if (source) {
                try {
                    source.setData(mapFeatures);
                    const selectedRoute = sortedSuggestedRoutes[currentlySelectedIdx];
                    let geometryForBounds = selectedRoute?.geometry;
                    if (!geometryForBounds && mapFeatures.features.length > 0) {
                         try { geometryForBounds = turf.featureCollection(mapFeatures.features); } catch(e) { /* ignore */ }
                    }
                    if (geometryForBounds) {
                         try {
                             const bounds = turf.bbox(geometryForBounds);
                             if (Array.isArray(bounds) && bounds.length === 4 && bounds.every(n => typeof n === 'number' && !isNaN(n))) {
                                 mapRef.current.fitBounds(bounds, { padding: { top: 60, bottom: 60, left: 380, right: 60 }, maxZoom: 16, duration: 500 });
                             }
                         } catch (e) { console.error("Error fitting bounds:", e); }
                    }
                } catch (error) { console.error("Error setting map source data:", error); }
            } else { console.error("Map source 'route-segments' not found during update!"); }
        };
        animationFrameId = requestAnimationFrame(performMapUpdate);
        return () => { if (animationFrameId) { cancelAnimationFrame(animationFrameId); } };
    }, [mapFeatures, isMapLoaded, currentlySelectedIdx, sortedSuggestedRoutes]);


    // --- Effect to handle stop markers when segment expands/collapses ---
    useEffect(() => {
        if (!isMapLoaded || !mapRef.current || !mapRef.current.isStyleLoaded()) { return; }

        if (expandedSegmentIndex !== null && currentSegments[expandedSegmentIndex]) {
            const segment = currentSegments[expandedSegmentIndex];
            if (Array.isArray(segment.fullStopSequence) && segment.fullStopSequence.length > 0) {
                console.log("Adding markers for stops:", segment.fullStopSequence);
                addStopMarkersForSegment(segment.geometry, segment.mode, segment.fullStopSequence);
            } else {
                console.log("No stop sequence found for expanded segment, clearing markers.");
                clearStopMarkers();
            }
        } else {
            clearStopMarkers();
        }
    }, [expandedSegmentIndex, currentSegments, isMapLoaded, addStopMarkersForSegment, clearStopMarkers]);


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
    const handleSortChange = (event) => { setSortBy(event.target.value); };

    // --- Handler for clicking a segment ---
    const handleSegmentClick = (index) => {
        setExpandedSegmentIndex(prevIndex => prevIndex === index ? null : index);
    };

    const toggleSidebar = () => {
        setIsSidebarVisible(prevState => !prevState);
    };

    useEffect(() => {
        const iconsLink = document.getElementById('material-icons-link');
        if (!iconsLink) {
             const link = document.createElement('link'); link.id = 'material-icons-link';
             link.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
             link.rel = 'stylesheet'; document.head.appendChild(link);
             return () => { const el = document.getElementById('material-icons-link'); if (el) el.remove(); };
        }
      }, []);


    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth < 768);
        };
        window.addEventListener('resize', handleResize);
        handleResize(); // Initial check
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const sidebarStyle = {
        position: "absolute",
        left: 0,
        top: 0,
        width: isMobile ? (isSidebarVisible ? "100%" : "0") : "350px", // Mobile is full width when visible
        height: isMobile ? "100vh" : "100%", // Mobile is full viewport height
        marginTop: isMobile ? "0" : "0", // No top margin for mobile, starts from the very top
        backdropFilter: "blur(5px)",
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        zIndex: 10,
        display: "flex",
        flexDirection: "column",
        boxShadow: '3px 0px 10px rgba(0,0,0,0.3)',
        transform: !isMobile ? "translateX(0)" : (isSidebarVisible ? "translateX(0)" : "translateX(-100%)"),
        transition: "transform 0.3s ease-in-out, width 0.3s ease-in-out, height 0.3s ease-in-out, margin-top 0.3s ease-in-out",
        overflow: 'hidden',
        borderRadius: isMobile ? "0" : "0", // No border radius if it's edge-to-edge full screen on mobile
    };

    const sidebarContentContainerStyle = {
        color: "white",
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        height: "100%",
        overflow: 'hidden',
    };

    const topBarStyle = {
        padding: isMobile ? "10px 12px" : "16px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexShrink: 0,
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
    };

    const scrollableContentAreaStyle = {
        padding: isMobile ? "10px 12px 12px 12px" : "0 16px 16px 16px",
        overflowY: 'auto',
        flexGrow: 1,
    };

    // Hamburger menu button: Only visible on mobile when sidebar is closed
    const menuButtonContainerStyle = {
        position: "fixed",
        top: isMobile ? "15px" : "16px", // Using mobile value, as it's hidden on desktop
        right: isMobile ? "15px" : "16px", // Using mobile value
        zIndex: 20,
        display: (isMobile && !isSidebarVisible) ? "flex" : "none",
        gap: "10px"
    };

    // Close button inside the sidebar: Only visible on mobile when sidebar is open
    const closeButtonStyleMobile = {
        backgroundColor: "transparent",
        color: "#fff",
        border: "none",
        cursor: "pointer",
        padding: "5px",
        display: 'flex', // This style is applied if the button is rendered
        alignItems: 'center',
        justifyContent: 'center'
    };

    return (
        <div style={{ position: "relative", height: "100vh", width: "100vw", fontFamily: "Montserrat, sans-serif", overflow: (isMobile && isSidebarVisible) ? 'hidden' : 'visible' }}>
            {/* Hamburger Menu Button: Will not display on desktop due to menuButtonContainerStyle.display */}
            <div style={menuButtonContainerStyle}>
                <button
                    onClick={toggleSidebar} // This toggleSidebar will primarily affect mobile
                    style={{
                        width: "36px",
                        height: "36px",
                        backgroundColor: "#1e40af",
                        color: "#fff",
                        borderRadius: "50%",
                        border: "none",
                        cursor: "pointer",
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
                    }}
                >
                    <span className="material-icons" style={{ fontSize: "20px" }}>menu</span>
                </button>
            </div>

            {/* Sidebar */}
            <div style={sidebarStyle}>
                <div style={sidebarContentContainerStyle}>
                    <div style={topBarStyle}>
                        <img
                            src={logo}
                            alt="Logo"
                            style={{
                                width: isMobile ? "30px" : "40px",
                                height: isMobile ? "30px" : "40px",
                                cursor: "pointer"
                            }}
                            onClick={() => navigate("/")}
                        />
                        <div style={{ display: "flex", gap: isMobile ? "8px" : "12px", alignItems: 'center' }}>
                            <button
                                onClick={() => navigate("/nav-view")}
                                style={{
                                    padding: isMobile ? "5px 8px" : "8px 12px",
                                    backgroundColor: "#1e40af",
                                    color: "#fff",
                                    border: "none",
                                    borderRadius: "5px",
                                    cursor: "pointer",
                                    fontFamily: "Montserrat, sans-serif",
                                    fontSize: isMobile ? '0.75rem' : '0.9rem'
                                }}
                            >
                                Back to Options
                            </button>
                            {/* Close button inside sidebar: Only for mobile */}
                            {isMobile && isSidebarVisible && (
                                <button
                                    onClick={toggleSidebar}
                                    style={closeButtonStyleMobile}
                                >
                                    <span className="material-icons" style={{ fontSize: "24px" }}>close</span>
                                </button>
                            )}
                        </div>
                    </div>

                    <div style={scrollableContentAreaStyle}>
                        <h1 style={{ fontSize: isMobile ? "1.1rem" : "1.4rem", fontWeight: "bold", marginBottom: "8px", marginTop: isMobile ? '5px' : '0' }}>Route Options</h1>
                        <p style={{ marginBottom: "12px", fontSize: isMobile ? '0.75rem' : '0.85rem', color: '#d1d5db' }}>
                            From <strong>{origin}</strong> to <strong>{destination}</strong>
                        </p>

                        <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <label htmlFor="sort-select" style={{ fontSize: isMobile ? '0.8rem' : '0.9rem', fontWeight: '600', color: '#d1d5db' }}>Sort by:</label>
                            <select
                                id="sort-select" value={sortBy} onChange={handleSortChange}
                                style={{
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)', color: 'white',
                                    border: '1px solid rgba(255, 255, 255, 0.3)', borderRadius: '5px', padding: '4px 6px',
                                    fontSize: isMobile ? '0.75rem' : '0.85rem', flexGrow: 1
                                }} >
                                <option style={{ color: 'black', backgroundColor: 'white' }} value="duration">Fastest</option>
                                <option style={{ color: 'black', backgroundColor: 'white' }} value="distance">Shortest Distance</option>
                                <option style={{ color: 'black', backgroundColor: 'white' }} value="fare">Cheapest</option>
                            </select>
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                {(Array.isArray(sortedSuggestedRoutes) && sortedSuggestedRoutes.length > 0) ? (
                                    sortedSuggestedRoutes.map((route, index) => {
                                        if (!route?.properties?.label) { return <li key={`invalid-${index}`} style={{ color: 'red', padding: '5px', fontSize: isMobile ? '0.75rem' : '0.85rem' }}>Invalid route data</li>; }
                                        const isSelected = index === currentlySelectedIdx;
                                        const label = route.properties.label;
                                        const durationMin = route.properties.summary_duration ? (route.properties.summary_duration / 60).toFixed(0) : '?';
                                        const fare = route.properties.total_fare;
                                        const fareString = typeof fare === 'number' ? `P${fare.toFixed(2)}` : '';
                                        return (
                                            <li key={label + index} onClick={() => { setCurrentlySelectedIdx(index); setSelectedRouteLabelState(label); }}
                                                style={{
                                                    border: `2px solid ${isSelected ? '#6ee7b7' : 'rgba(255,255,255,0.2)'}`, backgroundColor: isSelected ? "rgba(110, 231, 183, 0.2)" : "rgba(255, 255, 255, 0.1)",
                                                    borderRadius: "5px", padding: isMobile ? "6px 8px" : "10px 12px", marginBottom: "6px", cursor: "pointer", transition: 'background-color 0.2s ease, border-color 0.2s ease'
                                                }}
                                                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)'; }}
                                                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)'; }} >
                                                <div style={{ fontWeight: '600', fontSize: isMobile ? '0.85rem' : '0.95rem', marginBottom: '3px' }}>{label}</div>
                                                <div style={{ fontSize: isMobile ? '0.7rem' : '0.8rem', display: 'flex', justifyContent: 'space-between', color: '#d1d5db' }}>
                                                    <span>{durationMin !== '?' ? `~ ${durationMin} min` : 'Est. time unavailable'}</span>
                                                    <span>{fareString || 'Fare N/A'}</span>
                                                </div>
                                            </li>);
                                    })
                                ) : (<li style={{ color: '#a0aec0', fontSize: isMobile ? '0.8rem' : '0.9rem', textAlign: 'center' }}>No route options generated.</li>)}
                            </ul>
                        </div>

                        <hr style={{ border: 'none', borderTop: '1px solid rgba(255, 255, 255, 0.2)', margin: '15px 0' }} />

                        {currentRouteProps ? (
                            <>
                                <h2 style={{ fontSize: isMobile ? '1rem' : '1.1rem', marginBottom: '8px', fontWeight: '600' }}>Selected Route Details</h2>
                                <p style={{ marginBottom: '12px', fontSize: isMobile ? '0.8rem' : '0.9rem' }}>
                                    <span style={{ fontWeight: 'bold' }}>{currentRouteLabel}</span> (~{getCurrentTotalDurationMin()} min, {getCurrentTotalFare() || 'Fare N/A'})
                                </p>
                                {currentSegments && currentSegments.length > 0 ? (
                                    <div style={{
                                        display: "flex", height: "22px", width: "100%", overflow: "hidden",
                                        borderRadius: "5px", marginBottom: "15px", backgroundColor: '#374151'
                                    }}>
                                        {currentSegments.map((seg, idx) => {
                                            if (!seg || !seg.mode) return <div key={`invalid-seg-${idx}`} style={{ width: '5px', backgroundColor: 'red' }}></div>;
                                            const totalDuration = currentRouteProps?.summary_duration || 1;
                                            const durationOfSegment = seg?.duration || 0;
                                            const widthPercent = totalDuration > 0 ? ((durationOfSegment / totalDuration) * 100) : (currentSegments.length > 0 ? 100/currentSegments.length : 0);
                                            const displayWidth = Math.max(widthPercent, 2);
                                            return (
                                                <div key={`${seg.mode}-${idx}`} title={`${seg.mode}: ${((durationOfSegment) / 60).toFixed(1)} min`}
                                                    style={{
                                                        width: `${displayWidth}%`, backgroundColor: modeColors[seg.mode] || "#999", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                                                        fontSize: "0.65rem", color: "#fff", fontWeight: "bold", overflow: 'hidden', whiteSpace: 'nowrap',
                                                        borderRight: idx < currentSegments.length - 1 ? '1px solid rgba(255,255,255,0.2)' : 'none'
                                                    }} >
                                                    {widthPercent > 18 ? seg.mode : (widthPercent > 8 ? <span className="material-icons" style={{ fontSize: '14px' }}>{getModeIcon(seg.mode)}</span> : '')}
                                                </div>);
                                        })}
                                    </div>
                                ) : (<p style={{ fontSize: isMobile ? '0.8rem' : '0.9rem', color: '#a0aec0', textAlign: 'center' }}>No segments to display.</p>)}

                                {currentSteps && currentSteps.length > 0 ? (
                                    <div style={{ backgroundColor: "rgba(255, 255, 255, 0.08)", borderRadius: "5px", padding: "10px 12px", marginBottom: "5px", textAlign: "left", maxHeight: isMobile ? 'none' : 'calc(100vh - 550px)', overflowY: isMobile ? 'visible' : 'auto' }}>
                                        <h3 style={{ fontSize: isMobile ? '0.9rem' : "1.0rem", marginBottom: "8px", fontWeight: '600' }}>Driving Steps</h3>
                                        {currentSteps.map((step, idx) => (
                                            <div key={idx} style={{ display: "flex", alignItems: "center", marginBottom: "6px", fontSize: isMobile ? '0.75rem' : '0.85rem' }}>
                                                <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#6ee7b7", marginRight: "8px", flexShrink: 0 }} />
                                                <span>{(step?.Distance || 0).toFixed(0)} m - {((step?.DurationSeconds || 0) / 60).toFixed(1)} min</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : currentSegments && currentSegments.length > 0 && currentRouteProps?.primary_mode !== 'Driving' ? (
                                    <div style={{ backgroundColor: "rgba(255, 255, 255, 0.08)", borderRadius: "5px", padding: "10px 12px", marginBottom: "5px", textAlign: "left", maxHeight: isMobile ? 'none' : 'calc(100vh - 550px)', overflowY: isMobile ? 'visible' : 'auto' }}>
                                        <h3 style={{ fontSize: isMobile ? '0.9rem' : "1.0rem", marginBottom: "8px", fontWeight: '600' }}>Transit Segments</h3>
                                        {currentSegments.map((seg, idx) => {
                                            if (!seg || !seg.mode) return <div key={`invalid-detail-${idx}`} style={{ color: 'red', fontSize: isMobile ? '0.75rem' : '0.85rem' }}>Invalid segment data</div>;
                                            const isExpanded = expandedSegmentIndex === idx;
                                            const hasStopsToShow = Array.isArray(seg.fullStopSequence) && seg.fullStopSequence.length > 0;
                                            const isTransit = seg.mode !== 'Walk' && seg.mode !== 'Driving';

                                            return (
                                                <div key={`seg-detail-${idx}`} style={{ marginBottom: "6px", borderLeft: `3px solid ${modeColors[seg.mode] || '#ccc'}`, paddingLeft: '6px' }}>
                                                    <div onClick={isTransit ? () => handleSegmentClick(idx) : undefined}
                                                        style={{ display: "flex", alignItems: "center", fontSize: isMobile ? '0.75rem' : '0.85rem', cursor: isTransit ? 'pointer' : 'default', padding: '4px 0' }} >
                                                        <span className="material-icons" style={{ marginRight: '6px', color: modeColors[seg.mode] || '#ccc', fontSize: '18px' }}>{getModeIcon(seg.mode)}</span>
                                                        <span style={{ flexGrow: 1 }}>{seg.label || seg.mode} ({((seg?.duration || 0) / 60).toFixed(1)} min, {seg.distance ? (seg.distance / 1000).toFixed(1) : '?'} km)</span>
                                                        {seg.fare > 0 && <span style={{ marginLeft: '8px', fontWeight: 'bold' }}>(P{seg.fare.toFixed(2)})</span>}
                                                        {isTransit && hasStopsToShow && (
                                                            <span className="material-icons" style={{ fontSize: '16px', marginLeft: '4px', color: '#a0aec0' }}>
                                                                {isExpanded ? 'expand_less' : 'expand_more'}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {isExpanded && hasStopsToShow && (
                                                        <ol style={{ marginLeft: '20px', marginTop: '4px', marginBottom: '8px', fontSize: isMobile ? '0.7rem' : '0.8rem', color: '#cbd5e1', paddingLeft: '12px', listStyle: 'decimal' }}>
                                                            {seg.fullStopSequence.map((stopName, stopIdx) => (
                                                                <li key={`${idx}-${stopIdx}`} style={{ padding: '1px 0', borderBottom: stopIdx < seg.fullStopSequence.length - 1 ? '1px dotted rgba(255,255,255,0.2)' : 'none' }}>
                                                                    {stopIdx === 0 ? <strong>{stopName} (Board)</strong> : stopIdx === seg.fullStopSequence.length - 1 ? <strong>{stopName} (Alight)</strong> : stopName}
                                                                </li>
                                                            ))}
                                                        </ol>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (<p style={{ fontSize: isMobile ? '0.8rem' : '0.9rem', color: '#a0aec0', textAlign: 'center' }}>No steps available for this route.</p>)}
                            </>
                        ) : (<p style={{ fontSize: isMobile ? '0.8rem' : '0.9rem', color: '#a0aec0', textAlign: 'center', marginTop: '20px' }}>Select a route above to see details.</p>)}
                    </div>
                </div>
            </div>

            {/* Map Container: On desktop, the map will need to account for the persistent 350px sidebar.
                Consider adding a left margin/padding to the map container or its internal elements
                when !isMobile, e.g., style={{ marginLeft: !isMobile ? '350px' : '0' }}
                or by having the map library adjust its viewable bounds.
            */}
            <div ref={mapContainerRef} style={{
                width: !isMobile ? 'calc(100% - 350px)' : '100%', // Map takes remaining width on desktop
                height: "100%",
                position: "absolute",
                top: 0,
                left: !isMobile ? '350px' : '0', // Map starts after the sidebar on desktop
                zIndex: 1
            }} />

            {/* Mobile Overlay: Only for mobile */}
            {isMobile && isSidebarVisible && (
                <div
                    onClick={toggleSidebar}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.4)',
                        zIndex: 9,
                    }}
                />
            )}
        </div>
    );
};

export default RouteBreakdown;
