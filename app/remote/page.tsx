import { redirect } from 'next/navigation'

export default function RemoteIndexPage() {
  redirect('/remote/instances')
}
