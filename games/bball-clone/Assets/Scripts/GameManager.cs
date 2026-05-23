using UnityEngine;

public class GameManager : MonoBehaviour
{
    public static GameManager I;
    public Team home, away;
    public BallController Ball;
    public Hoop hoopHome, hoopAway;
    public int scoreHome, scoreAway;
    public float clock = 120f;
    public int quarter = 1;
    public string banner = "";
    float bannerTime;
    PlayerBase lastShooter;
    Vector3 lastShotFrom;

    public void Init(Team h, Team a, BallController ball, Hoop hh, Hoop ha)
    {
        I = this;
        home = h; away = a; Ball = ball;
        hoopHome = hh; hoopAway = ha;
        home.AssignHoops(hh, ha);
        away.AssignHoops(ha, hh);
        TipOff();
    }

    public void TipOff()
    {
        Ball.Loose(Vector3.up * 3.5f);
        Ball.Rb.velocity = Vector3.zero;
        Banner("Tip-off!", 1.5f);
    }

    void Update()
    {
        clock -= Time.deltaTime;
        if (clock <= 0)
        {
            clock = 120f;
            quarter++;
            if (quarter > 4) { Banner($"Final  {home.teamName} {scoreHome} - {scoreAway} {away.teamName}", 999f); enabled = false; return; }
            Banner($"Q{quarter}", 2f);
            ResetPositions();
        }
        if (bannerTime > 0) bannerTime -= Time.deltaTime;
        else if (banner != "") banner = "";
    }

    public Team OpposingTeam(Team t) => t == home ? away : home;

    public void OnScore(Hoop scoredIn, BallController ball)
    {
        bool homeScored = (scoredIn == hoopAway);
        int pts = lastShooter != null && Vector3.Distance(lastShotFrom, scoredIn.rimCenter) > 7.0f ? 3 : 2;
        if (homeScored) scoreHome += pts; else scoreAway += pts;
        Banner($"+{pts}!", 1.2f);
        ProcAudio.I?.PlaySwish(scoredIn.rimCenter);
        Invoke(nameof(ResetAfterScore), 1.5f);
    }

    void ResetAfterScore()
    {
        ResetPositions();
        Ball.Loose(Vector3.up * 1.5f);
    }

    public void OnShotAttempted(PlayerBase shooter, Vector3 from)
    {
        lastShooter = shooter;
        lastShotFrom = from;
    }

    public void OnBallOutOfBounds(BallController ball)
    {
        Banner("Out of bounds", 1.0f);
        Invoke(nameof(ResetAfterScore), 1.0f);
    }

    public void SwitchControl(HumanPlayer from, PlayerBase to)
    {
        if (to == null || to is HumanPlayer) return;
        Promote(to, isHuman: true);
        Promote(from, isHuman: false);
    }

    static void Promote(PlayerBase p, bool isHuman)
    {
        var go = p.gameObject;
        var team = p.team;
        var hand = p.HandAnchor;
        var own = p.ownHoop;
        var target = p.targetHoop;
        team.players.Remove(p);
        DestroyImmediate(p);
        PlayerBase fresh = isHuman ? go.AddComponent<HumanPlayer>() : go.AddComponent<AIPlayer>();
        fresh.team = team;
        fresh.HandAnchor = hand;
        fresh.ownHoop = own;
        fresh.targetHoop = target;
        team.players.Add(fresh);
    }

    void ResetPositions()
    {
        ResetTeam(home, +1);
        ResetTeam(away, -1);
    }

    void ResetTeam(Team t, int side)
    {
        Vector3[] offsets =
        {
            new(0,        1, -side * 2.0f),
            new(-3.5f,    1, -side * 4.5f),
            new(3.5f,     1, -side * 4.5f),
            new(-5.5f,    1, -side * 9.0f),
            new(5.5f,     1, -side * 9.0f),
        };
        for (int i = 0; i < t.players.Count && i < offsets.Length; i++)
        {
            var p = t.players[i];
            p.transform.position = offsets[i];
            var rb = p.GetComponent<Rigidbody>();
            rb.velocity = Vector3.zero;
            rb.angularVelocity = Vector3.zero;
        }
    }

    public void Banner(string msg, float seconds)
    {
        banner = msg;
        bannerTime = seconds;
    }
}
