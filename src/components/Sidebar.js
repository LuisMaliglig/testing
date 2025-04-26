import React from "react";

const Sidebar = ({ className = "" }) => {
  return (
    <div className={`w-60 h-full bg-white/90 shadow-lg p-4 ${className}`}>
      <h2 className="text-xl font-bold mb-4">Sidebar</h2>
      <ul className="space-y-2">
        <li><a href="/home" className="text-blue-600 hover:underline">Home</a></li>
        <li><a href="/map-view" className="text-blue-600 hover:underline">Map View</a></li>
        <li><a href="/nav-view" className="text-blue-600 hover:underline">Navigator</a></li>
      </ul>
    </div>
  );
};

export default Sidebar;