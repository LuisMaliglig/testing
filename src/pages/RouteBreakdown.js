import React, { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { awsConfig } from "../config/config";
import logo from "../assets/logo.png";

const RouteBreakdown = () => {
  const mapContainerRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { origin, destination, selectedRouteIndex } = location.state || {};

  useEffect(() => {
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: `https://maps.geo.${awsConfig.region}.amazonaws.com/maps/v0/maps/${awsConfig.mapName}/style-descriptor?key=${awsConfig.apiKey}`,
      center: [121.0357, 14.4981],
      zoom: 11,
    });

    return () => map.remove();
  }, []);

  // Dummy breakdown data (normally this would come from backend or calculation)
  const breakdowns = [
    {
      id: 1,
      steps: [
        { mode: "Walk", duration: 5 },
        { mode: "MRT", duration: 20 },
        { mode: "Walk", duration: 8 },
      ],
    },
    {
      id: 2,
      steps: [
        { mode: "Jeep", duration: 15 },
        { mode: "Walk", duration: 10 },
      ],
    },
    {
      id: 3,
      steps: [
        { mode: "Walk", duration: 10 },
        { mode: "LRT", duration: 25 },
        { mode: "Walk", duration: 5 },
      ],
    },
  ];

  const getTotalDuration = (steps) =>
    steps.reduce((sum, step) => sum + step.duration, 0);

  return (
    <div style={{ position: "relative", height: "100vh" }}>
      {/* Top Navigation */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "20px",
          backgroundColor: "rgba(0, 0, 0, 0.4)",
          zIndex: 20,
          position: "absolute",
          width: "100%",
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
            padding: "10px 16px",
            backgroundColor: "#1e40af",
            color: "#fff",
            border: "none",
            borderRadius: "15px",
            cursor: "pointer",
          }}
        >
          Back
        </button>
      </div>

      {/* Breakdown Content */}
      <div
        style={{
          position: "absolute",
          top: "80px",
          left: 0,
          width: "100%",
          height: "calc(100% - 80px)",
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
            textAlign: "center",
            color: "white",
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            padding: "24px",
            borderRadius: "15px",
            width: "90%",
            maxWidth: "500px",
            overflowY: "auto",
          }}
        >
          <h1 style={{ fontSize: "2rem", fontWeight: "bold", marginBottom: "20px" }}>
            Route Breakdown
          </h1>
          <p style={{ marginBottom: "20px" }}>
            From <strong>{origin}</strong> to <strong>{destination}</strong>
          </p>

          {breakdowns.map((route) => (
            <div
              key={route.id}
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.1)",
                borderRadius: "10px",
                padding: "16px",
                marginBottom: "20px",
                textAlign: "left",
              }}
            >
              <h2 style={{ fontSize: "1.2rem", marginBottom: "10px" }}>
                Alternative {route.id} ({getTotalDuration(route.steps)} min)
              </h2>
              <div>
                {route.steps.map((step, idx) => (
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
                        backgroundColor:
                          step.mode === "Walk"
                            ? "#6ee7b7"
                            : step.mode === "MRT"
                            ? "#fde68a"
                            : "#fdba74",
                        marginRight: "10px",
                      }}
                    />
                    <span>
                      {step.mode} - {step.duration} min
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Map Background */}
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
