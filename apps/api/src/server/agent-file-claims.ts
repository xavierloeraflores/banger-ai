import { ApiError } from './domain';
import { db } from './db';

// The unique project/path key makes acquisition atomic across API instances.
export async function claimAgentFile(project: string, path: string, owner: string, token: string) {
  const result = await db().query(`INSERT INTO agent_file_claims(project_id,path,owner_id,lease_token,expires_at)
    VALUES($1,$2,$3,$4,now()+interval '10 minutes')
    ON CONFLICT(project_id,path) DO UPDATE SET owner_id=$3,lease_token=$4,expires_at=now()+interval '10 minutes'
    WHERE agent_file_claims.expires_at<=now() OR (agent_file_claims.owner_id=$3 AND agent_file_claims.lease_token=$4)
    RETURNING path`, [project, path.toLowerCase(), owner, token]);
  if (!result.rowCount) throw new ApiError(409, `${path} is being edited in another chat.`);
}

export async function releaseAgentFiles(project: string, owner: string, token: string) {
  await db().query('DELETE FROM agent_file_claims WHERE project_id=$1 AND owner_id=$2 AND lease_token=$3', [project, owner, token]);
}
