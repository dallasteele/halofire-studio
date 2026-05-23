using UnityEngine;

public class AIPlayer : PlayerBase
{
    float decisionTimer;
    PlayerBase mark;
    Vector3 idleSpot;
    float skill;

    protected override void Awake()
    {
        base.Awake();
        skill = Random.Range(0.6f, 1.0f);
    }

    void Start()
    {
        idleSpot = transform.position;
    }

    protected override void FixedUpdate()
    {
        base.FixedUpdate();
        if (GameManager.I == null || Ball == null) return;
        decisionTimer -= Time.fixedDeltaTime;

        var ball = Ball;
        bool weHaveBall = ball.Holder != null && ball.Holder.team == team;
        bool iHaveBall = ball.Holder == this;

        if (iHaveBall)
        {
            DriveAndScore();
        }
        else if (weHaveBall)
        {
            MoveToOpenSpot();
        }
        else if (ball.Holder == null)
        {
            ChaseLooseBall();
        }
        else
        {
            DefendMark();
        }
    }

    void DriveAndScore()
    {
        Vector3 toHoop = targetHoop.rimCenter - transform.position;
        Vector3 dir = Vector3.ProjectOnPlane(toHoop, Vector3.up).normalized;
        float dist = new Vector2(toHoop.x, toHoop.z).magnitude;

        if (dist < Random.Range(3.5f, 6f) * skill && shotCooldown <= 0 && Random.value < 0.05f)
        {
            TryShoot(targetHoop.rimCenter, Random.Range(0.4f, 0.7f));
            return;
        }
        bool blocked = Physics.SphereCast(transform.position + Vector3.up, 0.6f, dir, out var hit, 2f);
        if (blocked && hit.collider.GetComponent<PlayerBase>() is PlayerBase p && p.team != team && Random.value < 0.02f)
        {
            var mate = team.NearestTo(targetHoop.rimCenter, this);
            if (mate != null) TryPass(mate);
            return;
        }
        MoveTowards(dir, dist > 8f);
    }

    void MoveToOpenSpot()
    {
        Vector3 toHoop = (targetHoop.rimCenter - transform.position);
        Vector3 fanout = Vector3.Cross(toHoop.normalized, Vector3.up) * Mathf.Sin(Time.time * 0.6f + GetInstanceID()) * 2.5f;
        Vector3 spot = Vector3.Lerp(transform.position, targetHoop.rimCenter, 0.3f) + fanout;
        Vector3 dir = Vector3.ProjectOnPlane(spot - transform.position, Vector3.up).normalized;
        MoveTowards(dir, false);
    }

    void ChaseLooseBall()
    {
        Vector3 dir = Vector3.ProjectOnPlane(Ball.transform.position - transform.position, Vector3.up).normalized;
        MoveTowards(dir, true);
        TryPickup();
    }

    void DefendMark()
    {
        if (mark == null || decisionTimer <= 0)
        {
            var opp = GameManager.I.OpposingTeam(team);
            mark = opp.NearestTo(transform.position, null);
            decisionTimer = 2f;
        }
        if (mark == null) return;
        Vector3 between = Vector3.Lerp(mark.Position, ownHoop.rimCenter, 0.35f);
        Vector3 dir = Vector3.ProjectOnPlane(between - transform.position, Vector3.up).normalized;
        MoveTowards(dir, Vector3.Distance(transform.position, between) > 3f);
        if (Ball.Holder == mark && Vector3.Distance(transform.position, Ball.transform.position) < 1.2f && Random.value < 0.02f * skill)
        {
            TryPickup();
        }
    }
}
