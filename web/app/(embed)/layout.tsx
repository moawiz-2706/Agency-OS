/** Pages made to sit inside an <iframe> on the public website: no app header or menu. */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <main className="bg-transparent p-1">{children}</main>;
}
