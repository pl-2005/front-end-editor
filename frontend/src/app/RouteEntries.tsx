import { useParams } from 'react-router-dom'
import { ProjectPage } from '../features/projects/pages/ProjectPage'
import { TeamPage } from '../features/teams/pages/TeamPage'
export function TeamRoute() {
  const { teamId } = useParams()
  return <TeamPage key={teamId} />
}

export function ProjectRoute() {
  const { teamId, projectId } = useParams()
  return <ProjectPage key={`${teamId}:${projectId}`} />
}
