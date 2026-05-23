using System.Collections.Generic;
using UnityEngine;

public class Team : MonoBehaviour
{
    public string teamName;
    public Color color;
    public int side;
    public List<PlayerBase> players = new();
    public Hoop targetHoop;
    public Hoop ownHoop;

    public static Team Spawn(string name, Color color, int side, Transform parent)
    {
        var go = new GameObject($"Team_{name}");
        go.transform.SetParent(parent);
        var t = go.AddComponent<Team>();
        t.teamName = name;
        t.color = color;
        t.side = side;

        Vector3[] offsets =
        {
            new(0,        0, -side * 2.0f),
            new(-3.5f,    0, -side * 4.5f),
            new(3.5f,     0, -side * 4.5f),
            new(-5.5f,    0, -side * 9.0f),
            new(5.5f,     0, -side * 9.0f),
        };

        for (int i = 0; i < 5; i++)
        {
            var pos = offsets[i];
            var skin = new Color(Random.Range(0.5f, 0.95f), Random.Range(0.4f, 0.8f), Random.Range(0.3f, 0.7f));
            var go2 = PlayerFactory.Build($"{name}_P{i}", color, skin, pos, t.transform);
            PlayerBase p;
            if (name == "Home" && i == 0) p = go2.AddComponent<HumanPlayer>();
            else p = go2.AddComponent<AIPlayer>();
            p.HandAnchor = go2.transform.Find("HandAnchor");
            p.team = t;
            t.players.Add(p);
        }
        return t;
    }

    public void AssignHoops(Hoop own, Hoop target)
    {
        ownHoop = own;
        targetHoop = target;
        foreach (var p in players) { p.ownHoop = own; p.targetHoop = target; }
    }

    public PlayerBase NearestTo(Vector3 pt, PlayerBase except = null)
    {
        PlayerBase best = null; float bestD = float.MaxValue;
        foreach (var p in players)
        {
            if (p == except) continue;
            float d = Vector3.Distance(p.Position, pt);
            if (d < bestD) { bestD = d; best = p; }
        }
        return best;
    }
}
