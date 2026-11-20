import React from "react";

export interface CyroBotIconProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  size?: number;
  className?: string;
}

export function CyroBotIcon({
  size,
  className = "w-4 h-4",
  alt = "CYRO",
  style,
  ...rest
}: CyroBotIconProps) {
  const inlineStyle: React.CSSProperties = {
    display: "inline-block",
    verticalAlign: "middle",
    flexShrink: 0,
    objectFit: "contain",
    ...style,
  };

  if (size) {
    inlineStyle.width = `${size}px`;
    inlineStyle.height = `${size}px`;
  }

  return (
    <img
      src="/cyro-bot.webp"
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={inlineStyle}
      {...rest}
    />
  );
}

export default CyroBotIcon;

