import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import AWS from "aws-sdk";
import { awsConfig } from "../config/config";
import logo from "../assets/logo.png";

const modeColors = {
  MRT: "#facc15",
  LRT: "#22c55e",
  Jeep: "#FFA500",
  "P2P-Bus": "#f97316",
  Bus: "#3b82f6",
};

const RouteBreakdown = () => {
  const mapContainerRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    origin,
    destination,
    suggestedRoutes,
    selectedRouteIndex,
    awsRouteData,
  } = location.state || {};

  const [steps, setSteps] = useState([]);
  const [segments, setSegments] = useState([]);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [121.0357, 14.4981],
      zoom: 11,
    });

    return () => map.remove();
  }, []);

  const loadRouteFromState = () => {
    if (!awsRouteData || !snappedRoutes || !suggestedRoutes) {
      console.warn("Missing route data. Check awsRouteData, snappedRoutes, or suggestedRoutes.");
      return;
    }
  
    const selectedRoute = suggestedRoutes[selectedRouteIndex];
    if (!selectedRoute) {
      console.warn("Selected route is undefined.");
      return;
    }
  
    const routeLabel = selectedRoute.properties.label;
    const awsRouteLabel = `Route ${selectedRouteIndex + 1}: ${awsRouteData.Summary.Distance.toFixed(2)} km, ${awsRouteData.Summary.DurationSeconds / 60.0.toFixed(1)} mins`;
  
    console.log("Selected route label:", routeLabel);
    console.log("AWS Route Data:", awsRouteData);
  
    const snapped = snappedRoutes.find(
      (route) => route.properties.label === routeLabel
    );
  
    console.log("Snapped Route:", snapped);
  
    if (!snapped || !snapped.properties || !snapped.properties.segments) {
      console.warn("No snapped route segments found for the selected route:", awsRouteLabel);
      setSegments([]); // Clear any previously shown segments
      return;
    }
  
    const segments = snapped.properties.segments;
    const modeTimeline = segments.map((seg, index) => ({
      id: index,
      mode: seg.mode,
      label: seg.label,
      distance: seg.distance,
      duration: seg.duration,
    }));
  
    setSegments(modeTimeline);
  };

  useEffect(() => {
    if (origin && destination && awsRouteData && AWS.config.credentials) {
      loadRouteFromState();
    }
  }, [origin, destination, awsRouteData]);

  const getTotalDuration = () =>
    steps.reduce((sum, step) => sum + (step.DurationSeconds || 0), 0) / 60;

  return (
    <div style={{ position: "relative", height: "100vh" }}>
      {/* Sidebar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          width: "100%",
          height: "100%",
          backdropFilter: "blur(4px)",
          backgroundColor: "rgba(0, 0, 0, 0.2)",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            textAlign: "center",
            color: "white",
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            padding: "32px",
            borderRadius: "5px",
            minWidth: "60%",
            maxWidth: "90%",
          }}
        >
          {/* Controls */}
          <div
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <img
              src={logo}
              alt="Logo"
              style={{ width: "40px", height: "40px", cursor: "pointer" }}
              onClick={() => navigate("/")}
            />
            <button
              onClick={() => navigate("/nav-view")}
              style={{
                padding: "8px 12px",
                backgroundColor: "#1e40af",
                color: "#fff",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer",
                fontFamily: "Montserrat, sans-serif",
              }}
            >
              Back
            </button>
          </div>

          {/* Header */}
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "20px" }}>
            Route Breakdown
          </h1>
          <p style={{ marginBottom: "20px" }}>
            From <strong>{origin}</strong> to <strong>{destination}</strong>
          </p>

          {/* Timeline */}
          {segments.length > 0 && (
            <div
              style={{
                display: "flex",
                height: "20px",
                width: "100%",
                overflow: "hidden",
                borderRadius: "10px",
                marginBottom: "20px",
              }}
            >
              {segments.map((seg, idx) => {
                const total = segments.reduce((s, t) => s + t.duration, 0);
                const widthPercent = ((seg.duration / total) * 100).toFixed(1);
                return (
                  <div
                    key={idx}
                    title={`${seg.mode}: ${(seg.duration / 60).toFixed(1)} min`}
                    style={{
                      width: `${widthPercent}%`,
                      backgroundColor: modeColors[seg.mode] || "#999",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.7rem",
                      color: "white",
                      fontWeight: "bold",
                    }}
                  >
                    {widthPercent > 10 ? seg.mode : ""}
                  </div>
                );
              })}
            </div>
          )}

          {/* Steps */}
          {steps.length > 0 ? (
            <div
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.1)",
                borderRadius: "5px",
                padding: "16px",
                marginBottom: "5px",
                textAlign: "left",
              }}
            >
              <h2 style={{ fontSize: "1.2rem", marginBottom: "10px" }}>
                Selected Route ({getTotalDuration().toFixed(1)} min)
              </h2>
              <div>
                {steps.map((step, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginBottom: "8px",
                    }}
                  >
                    <div
                      style={{
                        width: "12px",
                        height: "12px",
                        borderRadius: "50%",
                        backgroundColor: "#6ee7b7",
                        marginRight: "10px",
                      }}
                    />
                    <span>
                      {step?.Distance || "?"} m - {(step?.DurationSeconds / 60).toFixed(1)} min
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p>Loading route steps...</p>
          )}
        </div>
      </div>

      {/* Map */}
      <div
        ref={mapContainerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          top: 0,
          left: 0,
        }}
      />
    </div>
  );
};

export default RouteBreakdown;
