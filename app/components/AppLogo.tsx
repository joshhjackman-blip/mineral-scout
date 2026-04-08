import Image from 'next/image'

type AppLogoProps = {
  width?: number
  variant?: 'default' | 'light'
}

export default function AppLogo({ width = 150, variant = 'default' }: AppLogoProps) {
  const safeWidth = Math.max(40, Math.round(width))
  const safeHeight = Math.round((safeWidth * 100) / 360)
  const src = variant === 'light' ? '/mineral-map-logo-light.svg' : '/mineral-map-logo.svg'

  return (
    <Image
      src={src}
      alt="MineralMap logo"
      width={safeWidth}
      height={safeHeight}
      priority
      style={{ display: 'block', height: 'auto', width: safeWidth }}
    />
  )
}
