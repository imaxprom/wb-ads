export default function SubjectCell({ subject }: { subject: string | null }) {
  return <span className="text-sm">{subject || "—"}</span>;
}
