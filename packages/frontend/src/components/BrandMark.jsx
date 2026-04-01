const SIZE_CLASSES = {
  sm: 'h-10 w-10',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
  xl: 'h-20 w-20',
};

export default function BrandMark({ size = 'md', className = '', alt = 'Nöra logo' }) {
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;

  return (
    <img
      src="/nora-logo.png"
      alt={alt}
      className={`${sizeClass} block shrink-0 select-none object-contain ${className}`.trim()}
    />
  );
}
