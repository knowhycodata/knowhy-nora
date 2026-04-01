const SIZE_CLASSES = {
  sm: 'h-8 w-8 rounded-lg',
  md: 'h-9 w-9 rounded-[1rem]',
  lg: 'h-12 w-12 rounded-[1.25rem]',
  xl: 'h-16 w-16 rounded-[1.75rem]',
};

export default function BrandMark({ size = 'md', className = '', alt = 'Nora logo' }) {
  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.md;

  return (
    <img
      src="/nora-logo.png"
      alt={alt}
      className={`${sizeClass} object-cover shadow-[0_10px_28px_rgba(0,0,0,0.14)] ${className}`.trim()}
    />
  );
}
