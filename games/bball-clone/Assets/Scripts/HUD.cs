using UnityEngine;

public class HUD : MonoBehaviour
{
    GameManager gm;
    GUIStyle big, mid, banner;

    public void Init(GameManager g) { gm = g; }

    void OnGUI()
    {
        if (gm == null) return;
        big ??= new GUIStyle(GUI.skin.label) { fontSize = 36, alignment = TextAnchor.MiddleCenter, normal = { textColor = Color.white } };
        mid ??= new GUIStyle(GUI.skin.label) { fontSize = 18, alignment = TextAnchor.MiddleCenter, normal = { textColor = Color.white } };
        banner ??= new GUIStyle(GUI.skin.label) { fontSize = 48, alignment = TextAnchor.MiddleCenter, normal = { textColor = new Color(1, 0.85f, 0.2f) }, fontStyle = FontStyle.Bold };

        float w = 540, h = 80;
        var r = new Rect(Screen.width / 2 - w / 2, 10, w, h);
        GUI.Box(r, GUIContent.none);
        GUI.Label(new Rect(r.x, r.y + 6, w / 3, 30), gm.home.teamName, mid);
        GUI.Label(new Rect(r.x + w / 3, r.y + 6, w / 3, 30), $"Q{gm.quarter}  {Mathf.CeilToInt(gm.clock / 60)}:{(Mathf.CeilToInt(gm.clock) % 60):00}", mid);
        GUI.Label(new Rect(r.x + 2 * w / 3, r.y + 6, w / 3, 30), gm.away.teamName, mid);
        GUI.Label(new Rect(r.x, r.y + 36, w / 3, 40), gm.scoreHome.ToString(), big);
        GUI.Label(new Rect(r.x + 2 * w / 3, r.y + 36, w / 3, 40), gm.scoreAway.ToString(), big);

        if (!string.IsNullOrEmpty(gm.banner))
        {
            GUI.Label(new Rect(0, Screen.height / 2 - 60, Screen.width, 120), gm.banner, banner);
        }

        var help = "WASD move  •  Shift sprint  •  E pickup  •  LMB hold to charge shot  •  RMB pass  •  Space jump  •  Tab switch player";
        GUI.Label(new Rect(0, Screen.height - 28, Screen.width, 24), help, mid);
    }
}
