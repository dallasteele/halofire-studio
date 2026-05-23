using UnityEngine;

public static class Bootstrap
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Boot()
    {
        if (GameObject.Find("GameRoot") != null) return;
        var root = new GameObject("GameRoot");
        root.AddComponent<GameBootstrap>();
    }
}
