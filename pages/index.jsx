import dynamic from 'next/dynamic'

const LocalHubApp = dynamic(() => import('../components/LocalHubApp'), {
  ssr: false,
  loading: () => null,
})

export default function Page() {
  return <LocalHubApp />
}
