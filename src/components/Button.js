import React from "react";

const Button = ({ children, onClick, width = "auto", height = "auto" }) => {
  return (
    <button
      onClick={onClick}
      style={{ width, height }}
      className="rounded-[15px] bg-purple-600/70 hover:bg-purple-700 text-white font-medium px-4 py-2"
    >
      {children}
    </button>
  );
};

export default Button;