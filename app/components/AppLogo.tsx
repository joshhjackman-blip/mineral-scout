import Image from 'next/image'

type AppLogoProps = {
  width?: number
}

export default function AppLogo({ width = 150 }: AppLogoProps) {
  const safeWidth = Math.max(40, Math.round(width))
  const safeHeight = Math.round((safeWidth * 100) / 430)

  return (
    <Image
      src="/mineral-map-logo.svg"
      alt="MineralMap logo"
      width={safeWidth}
      height={safeHeight}
      priority
      style={{ display: 'block', height: 'auto', width: safeWidth }}
    />
  )
}
